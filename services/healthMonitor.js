const fs = require("node:fs");
const path = require("node:path");
const { ChannelType, EmbedBuilder } = require("discord.js");

const configPath = path.join(__dirname, "..", "data", "config.json");

function readConfigChannelId() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return typeof parsed.channelId === "string" ? parsed.channelId.trim() : "";
  } catch {
    return "";
  }
}

function resolveAlertChannelId() {
  return (
    process.env.ALERT_CHANNEL_ID ||
    readConfigChannelId() ||
    process.env.SHOP_CHANNEL_ID ||
    "1508937810563043470"
  );
}

function toErrorText(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

async function getAlertChannel(client) {
  const channelId = resolveAlertChannelId();
  if (!channelId) {
    return null;
  }

  const cached = client.channels.cache.get(channelId);
  const channel = cached || (await client.channels.fetch(channelId).catch(() => null));

  if (!channel || channel.type !== ChannelType.GuildText) {
    console.warn(`Alert-Channel nicht gefunden oder kein Textkanal: ${channelId}`);
    return null;
  }

  return channel;
}

async function sendHealthAlert(client, title, body, color = 0xed4245) {
  const channel = await getAlertChannel(client);
  if (!channel) {
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(truncate(body, 4000))
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

function parseHeartbeatMinutes() {
  const raw = process.env.HEALTH_HEARTBEAT_MINUTES;
  if (!raw) {
    return 0;
  }

  const minutes = Number.parseInt(raw, 10);
  if (!Number.isFinite(minutes) || minutes < 1) {
    return 0;
  }

  return minutes;
}

function initHealthMonitor(client) {
  if (client.healthMonitorInitialized) {
    return;
  }
  client.healthMonitorInitialized = true;

  const startupTs = Date.now();
  const notifyStartup = process.env.HEALTH_NOTIFY_STARTUP !== "false";
  const heartbeatMinutes = parseHeartbeatMinutes();

  client.once("clientReady", async () => {
    if (notifyStartup) {
      try {
        await sendHealthAlert(
          client,
          "✅ Bot online",
          `Der Bot ist gestartet und ueberwacht sich jetzt selbst.\nUptime: ${formatDuration(Date.now() - startupTs)}`,
          0x57f287
        );
      } catch (err) {
        console.error("Konnte Startup-Health-Alert nicht senden:", err.message);
      }
    }

    if (heartbeatMinutes > 0) {
      setInterval(async () => {
        try {
          const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
          const body = [
            "Health-Heartbeat",
            `Uptime: ${formatDuration(process.uptime() * 1000)}`,
            `Memory (RSS): ${memoryMb} MB`,
            `Guilds: ${client.guilds.cache.size}`
          ].join("\n");

          await sendHealthAlert(client, "💓 Bot heartbeat", body, 0x5865f2);
        } catch (err) {
          console.error("Heartbeat konnte nicht gesendet werden:", err.message);
        }
      }, heartbeatMinutes * 60 * 1000).unref();
    }
  });

  process.on("unhandledRejection", (reason) => {
    const text = toErrorText(reason);
    console.error("Unhandled rejection:", text);

    if (client.isReady()) {
      sendHealthAlert(client, "🚨 Unhandled Rejection", `\`\`\`\n${truncate(text, 3500)}\n\`\`\``).catch(() => {});
    }
  });

  process.on("uncaughtException", (error) => {
    const text = toErrorText(error);
    console.error("Uncaught exception:", text);

    if (client.isReady()) {
      sendHealthAlert(client, "🚨 Uncaught Exception", `\`\`\`\n${truncate(text, 3500)}\n\`\`\``).catch(() => {});
    }
  });

  client.on("error", (error) => {
    const text = toErrorText(error);
    if (!client.isReady()) {
      return;
    }

    sendHealthAlert(client, "⚠️ Discord client error", `\`\`\`\n${truncate(text, 3500)}\n\`\`\``).catch(() => {});
  });

  client.on("shardError", (error) => {
    const text = toErrorText(error);
    if (!client.isReady()) {
      return;
    }

    sendHealthAlert(client, "⚠️ Shard error", `\`\`\`\n${truncate(text, 3500)}\n\`\`\``).catch(() => {});
  });

  client.on("invalidated", () => {
    if (!client.isReady()) {
      return;
    }

    sendHealthAlert(
      client,
      "🚨 Session invalidated",
      "Die Discord Session wurde invalidiert. PM2 sollte den Bot automatisch neu starten."
    ).catch(() => {});
  });
}

module.exports = {
  initHealthMonitor
};
