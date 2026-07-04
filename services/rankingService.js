const { chromium } = require("playwright");

const PLAYLIST_CONFIGS = [
  { key: "casual", label: "Casual", matchers: [/^casual$/i] },
  { key: "duel", label: "Ranked Duel (1v1)", matchers: [/ranked duel\s*1v1/i, /duel\s*1v1/i, /1v1/i] },
  { key: "doubles", label: "Ranked Doubles (2v2)", matchers: [/ranked doubles\s*2v2/i, /doubles\s*2v2/i, /2v2/i] },
  { key: "standard", label: "Ranked Standard (3v3)", matchers: [/ranked standard\s*3v3/i, /standard\s*3v3/i, /trios/i, /3v3/i] },
  { key: "tournament", label: "Tournament Rank", matchers: [/tournament matches/i, /tournament/i] }
];

const RANK_NAMES = [
  "Unranked",
  "Bronze I", "Bronze II", "Bronze III",
  "Silver I", "Silver II", "Silver III",
  "Gold I", "Gold II", "Gold III",
  "Platinum I", "Platinum II", "Platinum III",
  "Diamond I", "Diamond II", "Diamond III",
  "Champion I", "Champion II", "Champion III",
  "Grand Champion I", "Grand Champion II", "Grand Champion III",
  "Supersonic Legend"
];

const TRACKING_MAX_ATTEMPTS = parsePositiveInt(process.env.TRACKING_MAX_ATTEMPTS, 3);
const TRACKING_NAV_TIMEOUT_MS = parsePositiveInt(process.env.TRACKING_NAV_TIMEOUT_MS, 35000);
const TRACKING_POST_LOAD_WAIT_MS = parsePositiveInt(process.env.TRACKING_POST_LOAD_WAIT_MS, 7000);

async function getPlayerRanks(epicUserId) {
  if (!epicUserId || typeof epicUserId !== "string") {
    throw new Error("Invalid Epic Games ID provided");
  }

  const normalizedEpicId = epicUserId.trim();
  const profileUrl = `https://rocketleague.tracker.network/rocket-league/profile/epic/${encodeURIComponent(normalizedEpicId)}/overview`;
  let lastError = new Error("API_UNAVAILABLE");

  for (let attempt = 1; attempt <= TRACKING_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await scrapeAttempt(profileUrl, normalizedEpicId, attempt);
    } catch (error) {
      if (error.message === "PLAYER_NOT_FOUND") {
        throw new Error("Player not found");
      }

      lastError = error;
      const retryable = isRetryableTrackingError(error.message);

      console.warn(`[Ranking Service] Attempt ${attempt}/${TRACKING_MAX_ATTEMPTS} failed: ${error.message}`);

      if (!retryable || attempt === TRACKING_MAX_ATTEMPTS) {
        break;
      }

      await delay(attempt * 1200);
    }
  }

  console.error(`[Ranking Service] Failed to render tracker page: ${lastError.message}`);

  if (String(lastError.message).includes("ANTI_BOT_BLOCKED")) {
    throw new Error("TRACKER_BLOCKED");
  }

  if (String(lastError.message).includes("UPSTREAM_5XX")) {
    throw new Error("TRACKER_UNAVAILABLE");
  }

  if (String(lastError.message).includes("LAYOUT_CHANGED_OR_BLOCKED")) {
    throw new Error("TRACKER_LAYOUT_CHANGED");
  }

  throw new Error("API_UNAVAILABLE");
}

async function scrapeAttempt(profileUrl, epicUserId, attempt) {
  let browser;

  const headless = process.env.PLAYWRIGHT_HEADLESS !== "false";
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-features=IsolateOrigins,site-per-process"
  ];

  if (process.platform === "linux") {
    launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  try {
    console.log(`[Ranking Service] Rendering tracker page for: ${epicUserId} (attempt ${attempt})`);

    browser = await chromium.launch({
      headless,
      args: launchArgs
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 1700 },
      locale: "en-US",
      timezoneId: "Europe/Berlin",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "accept-language": "en-US,en;q=0.9,de;q=0.8"
      }
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined
      });
    });

    const page = await context.newPage();
    const apiPayloads = [];

    page.on("response", async (response) => {
      try {
        await collectApiPayload(response, apiPayloads);
      } catch {
        // Best-effort only.
      }
    });

    const response = await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: TRACKING_NAV_TIMEOUT_MS
    });

    const status = response?.status() ?? 0;
    console.log(`[Ranking Service] Page status: ${status}`);

    if (status === 404) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    if (status === 403) {
      throw new Error("ANTI_BOT_BLOCKED");
    }

    if (status >= 500) {
      throw new Error("UPSTREAM_5XX");
    }

    await page.waitForTimeout(TRACKING_POST_LOAD_WAIT_MS);

    const pageTitle = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (isPlayerNotFoundText(bodyText)) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    if (isPlayerNotFoundText(pageTitle)) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    if (isAntiBotText(bodyText)) {
      throw new Error("ANTI_BOT_BLOCKED");
    }

    const rows = await extractRowsFromDom(page);
    console.log(`[Ranking Service] Rows found: ${rows.length}`);

    if (rows.length) {
      const profileName = extractProfileName(rows, epicUserId);
      const ranks = extractPlaylistRanks(rows);

      if (hasMeaningfulRanks(ranks)) {
        return {
          epicUserId,
          displayName: profileName,
          platform: "Epic Games",
          lastUpdated: new Date(),
          ranks
        };
      }

      if (isLikelyProfileWithoutStats(bodyText, rows)) {
        throw new Error("PLAYER_NOT_FOUND");
      }
    }

    const apiData = extractFromApiPayloads(apiPayloads, epicUserId);
    if (apiData) {
      return apiData;
    }

    throw new Error("LAYOUT_CHANGED_OR_BLOCKED");
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function collectApiPayload(response, payloads) {
  const url = response.url();
  const lowerUrl = url.toLowerCase();

  if (!lowerUrl.includes("rocketleague.tracker.network") || !lowerUrl.includes("api")) {
    return;
  }

  const headers = response.headers();
  const contentType = String(headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return;
  }

  const status = response.status();
  if (status >= 500) {
    payloads.push({ url, status, error: "UPSTREAM_5XX" });
    return;
  }

  const data = await response.json().catch(() => null);
  payloads.push({ url, status, data });
}

function extractRowsFromDom(page) {
  return page.locator("tr").evaluateAll((tableRows) =>
    tableRows
      .map((row) => row.innerText.replace(/\r/g, "").trim())
      .filter(Boolean)
  );
}

function extractFromApiPayloads(payloads, epicUserId) {
  if (!payloads.length) {
    return null;
  }

  const allTexts = payloads
    .map((p) => toSearchableString(p.data || p.error || ""))
    .join("\n")
    .toLowerCase();

  if (isPlayerNotFoundText(allTexts)) {
    throw new Error("PLAYER_NOT_FOUND");
  }

  const candidates = [];
  for (const payload of payloads) {
    findStatCandidates(payload.data, candidates, 0);
  }

  if (!candidates.length) {
    return null;
  }

  const ranks = {
    casual: createEmptyRank("Casual"),
    duel: createEmptyRank("Ranked Duel (1v1)"),
    doubles: createEmptyRank("Ranked Doubles (2v2)"),
    standard: createEmptyRank("Ranked Standard (3v3)"),
    tournament: createEmptyRank("Tournament Rank")
  };

  for (const item of candidates) {
    const key = classifyPlaylistKey(item.playlistName);
    if (!key) {
      continue;
    }

    const mmr = normalizeNumber(item.mmr);
    const rank = item.rankName || "Unranked";
    const division = item.divisionName || "—";

    if (Number.isFinite(mmr) || rank !== "Unranked") {
      ranks[key] = {
        name: ranks[key].name,
        mmr: Number.isFinite(mmr) ? mmr : null,
        division,
        rank
      };
    }
  }

  if (!hasMeaningfulRanks(ranks)) {
    return null;
  }

  return {
    epicUserId,
    displayName: epicUserId,
    platform: "Epic Games",
    lastUpdated: new Date(),
    ranks
  };
}

function findStatCandidates(value, out, depth) {
  if (!value || depth > 10) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      findStatCandidates(item, out, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const playlistName = pickPlaylistName(value);
  const mmr = pickMmrValue(value);
  const rankName = pickRankName(value);
  const divisionName = pickDivision(value);

  if (playlistName && (Number.isFinite(mmr) || rankName)) {
    out.push({ playlistName, mmr, rankName, divisionName });
  }

  for (const nested of Object.values(value)) {
    findStatCandidates(nested, out, depth + 1);
  }
}

function pickPlaylistName(value) {
  const possible = [
    value?.playlist,
    value?.playlistName,
    value?.mode,
    value?.modeName,
    value?.name,
    value?.title,
    value?.metadata?.name,
    value?.attributes?.playlist
  ];

  for (const entry of possible) {
    if (typeof entry === "string" && entry.trim().length >= 3) {
      return entry.trim();
    }
  }

  return null;
}

function pickMmrValue(value) {
  const possible = [
    value?.mmr,
    value?.rating,
    value?.elo,
    value?.skillRating,
    value?.stats?.mmr,
    value?.stats?.rating,
    value?.mmr?.value,
    value?.rating?.value,
    value?.stats?.mmr?.value,
    value?.stats?.rating?.value
  ];

  for (const entry of possible) {
    const normalized = normalizeNumber(entry);
    if (Number.isFinite(normalized) && normalized >= 100 && normalized <= 3000) {
      return normalized;
    }
  }

  return null;
}

function pickRankName(value) {
  const possible = [
    value?.rank,
    value?.tier,
    value?.stats?.rank,
    value?.stats?.tier,
    value?.rank?.name,
    value?.tier?.name,
    value?.rank?.metadata?.name,
    value?.tier?.metadata?.name
  ];

  for (const entry of possible) {
    if (typeof entry === "string") {
      const rank = extractRank(entry);
      if (rank) {
        return rank;
      }

      if (/unranked/i.test(entry)) {
        return "Unranked";
      }
    }
  }

  return null;
}

function pickDivision(value) {
  const possible = [
    value?.division,
    value?.divisionName,
    value?.stats?.division,
    value?.division?.name,
    value?.division?.metadata?.name
  ];

  for (const entry of possible) {
    if (typeof entry === "string" && entry.trim()) {
      const match = entry.match(/([IVX]+)$/i);
      if (match?.[1]) {
        return match[1].toUpperCase();
      }
      return entry.trim();
    }

    if (typeof entry === "number" && entry > 0 && entry < 10) {
      return String(entry);
    }
  }

  return "—";
}

function classifyPlaylistKey(playlistName) {
  if (!playlistName) {
    return null;
  }

  const lower = playlistName.toLowerCase();
  if (lower.includes("casual")) {
    return "casual";
  }
  if (lower.includes("duel") || lower.includes("1v1")) {
    return "duel";
  }
  if (lower.includes("doubles") || lower.includes("2v2")) {
    return "doubles";
  }
  if (lower.includes("standard") || lower.includes("3v3") || lower.includes("trios")) {
    return "standard";
  }
  if (lower.includes("tournament")) {
    return "tournament";
  }

  return null;
}

function extractProfileName(rows, fallbackName) {
  const titleRow = rows.find((row) => /'s Rocket League (Overview )?Stats/i.test(row));
  if (titleRow) {
    const match = titleRow.match(/^(.+?)'s Rocket League/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return fallbackName;
}

function extractPlaylistRanks(rows) {
  const ranks = {
    casual: createEmptyRank("Casual"),
    duel: createEmptyRank("Ranked Duel (1v1)"),
    doubles: createEmptyRank("Ranked Doubles (2v2)"),
    standard: createEmptyRank("Ranked Standard (3v3)"),
    tournament: createEmptyRank("Tournament Rank")
  };

  const casualRow = findCasualRow(rows);
  if (casualRow) {
    const parsedCasual = parseRankRow(casualRow, "Casual");
    if (parsedCasual) {
      ranks.casual = parsedCasual;
    }
  }

  for (const config of PLAYLIST_CONFIGS) {
    if (config.key === "casual") {
      continue;
    }

    const row = findBestRow(rows, config.matchers);
    if (!row) {
      continue;
    }

    const parsed = parseRankRow(row, config.label);
    if (parsed) {
      ranks[config.key] = parsed;
    }
  }

  return ranks;
}

function hasMeaningfulRanks(ranks) {
  return Object.values(ranks || {}).some((rank) => {
    if (!rank) {
      return false;
    }

    if (Number.isFinite(rank.mmr)) {
      return true;
    }

    return Boolean(rank.rank && !/^unranked$/i.test(rank.rank) && !/^n\/a$/i.test(rank.rank));
  });
}

function findCasualRow(rows) {
  return rows.find((row) => /^Casual\b/i.test(row)) || rows.find((row) => /\nCasual\n/i.test(row)) || null;
}

function findBestRow(rows, matchers) {
  const startMatch = rows.find((row) => {
    const firstLine = row.split(/\n+/).map((line) => line.trim()).filter(Boolean)[0] || "";
    return matchers.some((matcher) => matcher.test(firstLine));
  });

  if (startMatch) {
    return startMatch;
  }

  const preferredRow = rows.find((row) => {
    if (!matchers.some((matcher) => matcher.test(row))) {
      return false;
    }

    return !/^\d+\s+Matches/i.test(row) && !/^(Win|Loss|Defeat|Multiple)\b/i.test(row);
  });

  if (preferredRow) {
    return preferredRow;
  }

  return rows.find((row) => matchers.some((matcher) => matcher.test(row))) || null;
}

function parseRankRow(row, fallbackName) {
  const lines = row.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const playlistLine = lines.find((line) => /Ranked Duel|Ranked Doubles|Ranked Standard|Tournament Matches|Casual/i.test(line)) || fallbackName;
  const rankLine = lines.find((line) => /Division\s+[IVX]+|N\/A|Unranked|Bronze|Silver|Gold|Platinum|Diamond|Champion|Grand Champion|Supersonic Legend/i.test(line)) || "";
  const mmrLine = lines.find((line) => /^\d{1,3}(?:,\d{3})*$/.test(line)) || null;

  const rank = extractRank(rankLine);
  const division = extractDivision(rankLine);
  let mmr = mmrLine ? Number(mmrLine.replace(/,/g, "")) : null;

  if (playlistLine.includes("Casual") && mmr === null) {
    const casualMatch = row.match(/Casual[\s\S]*?(\d{1,3}(?:,\d{3})*)/i);
    if (casualMatch?.[1]) {
      mmr = Number(casualMatch[1].replace(/,/g, ""));
    }
  }

  return {
    name: playlistLine.includes("Casual") ? "Casual" : fallbackName,
    mmr,
    division: division || "—",
    rank: rank || (playlistLine.includes("Casual") ? "N/A" : "Unranked")
  };
}

function extractRank(text) {
  if (/^N\/A$/i.test(text)) {
    return "N/A";
  }

  const rankedPattern = new RegExp(`\\b(${RANK_NAMES.map(escapeRegExp).join("|")})\\b`, "i");
  const match = text.match(rankedPattern);
  return match?.[1] ? normalizeRankName(match[1]) : null;
}

function extractDivision(text) {
  const match = text.match(/Division\s+([IVX]+)/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

function normalizeRankName(rankName) {
  const normalized = rankName.replace(/\s+/g, " ").trim();

  if (/^grand champion$/i.test(normalized)) {
    return "Grand Champion I";
  }

  return normalized;
}

function createEmptyRank(name) {
  return {
    name,
    mmr: null,
    division: "—",
    rank: "Unranked"
  };
}

function isAntiBotText(text) {
  if (!text) {
    return false;
  }

  const lowered = text.toLowerCase();
  return (
    lowered.includes("verify you are human") ||
    lowered.includes("attention required") ||
    lowered.includes("cf-challenge") ||
    lowered.includes("cloudflare") ||
    lowered.includes("access denied") ||
    lowered.includes("too many requests")
  );
}

function isPlayerNotFoundText(text) {
  if (!text) {
    return false;
  }

  const lowered = text.toLowerCase();
  return (
    lowered.includes("player not found") ||
    lowered.includes("no results found") ||
    lowered.includes("we could not find") ||
    lowered.includes("profile does not exist") ||
    lowered.includes("no stats found") ||
    lowered.includes("no stats available") ||
    lowered.includes("no tracked matches")
  );
}

function isLikelyProfileWithoutStats(bodyText, rows) {
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  if (rowCount > 0 && rowCount <= 3) {
    const lowered = String(bodyText || "").toLowerCase();
    return (
      lowered.includes("no stats") ||
      lowered.includes("no data") ||
      lowered.includes("not enough matches") ||
      lowered.includes("could not find")
    );
  }

  return false;
}

function isRetryableTrackingError(code) {
  return [
    "ANTI_BOT_BLOCKED",
    "LAYOUT_CHANGED_OR_BLOCKED",
    "UPSTREAM_5XX",
    "API_UNAVAILABLE",
    "Timeout"
  ].some((needle) => String(code || "").includes(needle));
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toSearchableString(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parsePositiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  getPlayerRanks
};
