const { chromium } = require("playwright");

const PLAYLIST_CONFIGS = [
  { key: "casual", label: "Casual", matchers: [/^casual$/i] },
  { key: "duel", label: "Ranked Duel (1v1)", matchers: [/ranked duel\s*1v1/i, /duel\s*1v1/i] },
  { key: "doubles", label: "Ranked Doubles (2v2)", matchers: [/ranked doubles\s*2v2/i, /doubles\s*2v2/i] },
  { key: "standard", label: "Ranked Standard (3v3)", matchers: [/ranked standard\s*3v3/i, /standard\s*3v3/i, /trios/i] },
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

async function getPlayerRanks(epicUserId) {
  if (!epicUserId || typeof epicUserId !== "string") {
    throw new Error("Invalid Epic Games ID provided");
  }

  const profileUrl = `https://rocketleague.tracker.network/rocket-league/profile/epic/${encodeURIComponent(epicUserId)}/overview`;
  let browser;
  const headless = process.env.PLAYWRIGHT_HEADLESS !== "false";
  const launchArgs = ["--disable-blink-features=AutomationControlled"];

  if (process.platform === "linux") {
    launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  try {
    console.log(`[Ranking Service] Rendering tracker page for: ${epicUserId}`);

    browser = await chromium.launch({
      headless,
      args: launchArgs
    });

    const page = await browser.newPage({
      viewport: { width: 1440, height: 1600 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    });

    const response = await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const status = response?.status() ?? 0;
    console.log(`[Ranking Service] Page status: ${status}`);

    await page.waitForTimeout(6000);

    const rows = await page.locator("tr").evaluateAll((tableRows) =>
      tableRows.map((row) => row.innerText.replace(/\r/g, "").trim()).filter(Boolean)
    );

    console.log(`[Ranking Service] Rows found: ${rows.length}`);

    if (!rows.length) {
      throw new Error("API_UNAVAILABLE");
    }

    if (rows.some((row) => /player not found|no results found|not found/i.test(row))) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    const profileName = extractProfileName(rows, epicUserId);
    const ranks = extractPlaylistRanks(rows);

    if (!ranks.duel && !ranks.doubles && !ranks.standard && !ranks.tournament && !ranks.casual) {
      throw new Error("API_UNAVAILABLE");
    }

    return {
      epicUserId,
      displayName: profileName,
      platform: "Epic Games",
      lastUpdated: new Date(),
      ranks
    };
  } catch (error) {
    if (error.message === "PLAYER_NOT_FOUND") {
      throw new Error("Player not found");
    }

    console.error(`[Ranking Service] Failed to render tracker page: ${error.message}`);
    return createDemoPlayerData(epicUserId);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function createDemoPlayerData(epicUserId) {
  // Deterministic fallback so the same player gets stable demo values.
  const seed = Math.abs(
    Array.from(epicUserId).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  );

  const makeRank = (name, baseMmr, offset) => {
    const mmr = baseMmr + ((seed + offset) % 120);
    return {
      name,
      mmr,
      division: ["I", "II", "III", "IV"][(seed + offset) % 4],
      rank: mmrToRankName(mmr)
    };
  };

  return {
    epicUserId,
    displayName: epicUserId,
    platform: "Epic Games",
    lastUpdated: new Date(),
    isDemo: true,
    ranks: {
      casual: {
        name: "Casual",
        mmr: 900 + (seed % 200),
        division: "—",
        rank: "N/A"
      },
      duel: makeRank("Ranked Duel (1v1)", 800, 11),
      doubles: makeRank("Ranked Doubles (2v2)", 1000, 29),
      standard: makeRank("Ranked Standard (3v3)", 950, 47),
      tournament: makeRank("Tournament Rank", 900, 73)
    }
  };
}

function mmrToRankName(mmr) {
  if (!Number.isFinite(mmr)) {
    return "Unranked";
  }

  const thresholds = [
    { min: 1540, rank: "Supersonic Legend" },
    { min: 1435, rank: "Grand Champion III" },
    { min: 1335, rank: "Grand Champion II" },
    { min: 1235, rank: "Grand Champion I" },
    { min: 1180, rank: "Champion III" },
    { min: 1130, rank: "Champion II" },
    { min: 1075, rank: "Champion I" },
    { min: 1015, rank: "Diamond III" },
    { min: 955, rank: "Diamond II" },
    { min: 895, rank: "Diamond I" },
    { min: 835, rank: "Platinum III" },
    { min: 775, rank: "Platinum II" },
    { min: 715, rank: "Platinum I" },
    { min: 655, rank: "Gold III" },
    { min: 595, rank: "Gold II" },
    { min: 535, rank: "Gold I" },
    { min: 475, rank: "Silver III" },
    { min: 415, rank: "Silver II" },
    { min: 355, rank: "Silver I" },
    { min: 295, rank: "Bronze III" },
    { min: 235, rank: "Bronze II" },
    { min: 175, rank: "Bronze I" }
  ];

  for (const entry of thresholds) {
    if (mmr >= entry.min) {
      return entry.rank;
    }
  }

  return "Unranked";
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  getPlayerRanks
};