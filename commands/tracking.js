const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getPlayerRanks } = require("../services/rankingService");

/**
 * Tracking Command - Zeigt Rocket League Ränge eines Spielers an
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("tracking")
    .setDescription("Zeigt die Rocket League Ränge eines Spielers an")
    .addStringOption((option) =>
      option
        .setName("epic_id")
        .setDescription("Epic Games ID des Spielers (z.B. GamerTag#1234)")
        .setRequired(true)
    ),

  /**
   * Führt den /tracking Command aus
   * @param {ChatInputCommandInteraction} interaction - Discord Interaction
   */
  async execute(interaction) {
    await interaction.deferReply();

    try {
      const epicId = interaction.options.getString("epic_id").trim();

      // Validiere Epic Games ID Format
      if (!epicId || epicId.length < 3 || epicId.length > 50) {
        await interaction.editReply({
          content: "❌ Die Epic Games ID muss zwischen 3 und 50 Zeichen lang sein.",
          flags: 64
        });
        return;
      }

      // Statusmeldung
      await interaction.editReply({
        content: "🔄 Lade Rangdaten... bitte warten.",
        flags: 64
      });

      // Hole Rangdaten von der API
      let playerData;
      try {
        playerData = await getPlayerRanks(epicId);
      } catch (apiError) {
        console.error("API Error:", apiError.message);

        if (apiError.message.includes("not found") || apiError.message.includes("404")) {
          await interaction.editReply({
            content: `❌ Kein Spieler mit der Epic Games ID \`${epicId}\` gefunden.`,
            flags: 64
          });
        } else {
          await interaction.editReply({
            content: "❌ Die Rocket League API ist momentan nicht erreichbar. Bitte später erneut versuchen.",
            flags: 64
          });
        }
        return;
      }

      // Baue das Embed
      const embed = buildRankingEmbed(playerData);

      await interaction.editReply({
        embeds: [embed],
        flags: 64
      });
    } catch (error) {
      console.error("Command execution error:", error);

      // Fehlerbehandlung für abgelaufene Interactions
      if (error.code === 10062 || error.code === 40060) {
        console.warn("Interaction abgelaufen, kann nicht mehr antworten.");
        return;
      }

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "❌ Ein unerwarteter Fehler ist aufgetreten.",
            flags: 64
          });
        } else {
          await interaction.reply({
            content: "❌ Ein unerwarteter Fehler ist aufgetreten.",
            flags: 64
          });
        }
      } catch (replyError) {
        if (replyError.code !== 10062 && replyError.code !== 40060) {
          console.error("Could not reply to interaction:", replyError.message);
        }
      }
    }
  }
};

/**
 * Baue ein schönes Embed mit Rangdaten
 * @param {Object} playerData - Spielerdaten vom Service
 * @returns {EmbedBuilder} Discord Embed
 */
function buildRankingEmbed(playerData) {
  const { displayName, ranks, lastUpdated, isDemo } = playerData;

  // Rocket League Logo URL
  const RL_LOGO = "https://www.rlbot.org/imgs/rocket-league-icon.png";

  let description = `**Spieler:** ${displayName}\n**Epic Games ID:** \`${playerData.epicUserId}\``;
  
  // Wenn Demo-Daten, hinzufügen
  if (isDemo) {
    description += "\n⚠️ *Demo-Daten (APIs nicht erreichbar)*";
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 Rocket League Rank Tracking")
    .setDescription(description)
    .setColor(isDemo ? 0xffa500 : 0x0a84ff) // Orange wenn Demo, Blau wenn real
    .setThumbnail(RL_LOGO)
    .setTimestamp(lastUpdated);

  // Füge alle Ränge hinzu
  for (const [key, rankData] of Object.entries(ranks)) {
    if (!rankData.mmr && key !== "casual") {
      continue; // Überspringe Ränge ohne Daten (außer Casual)
    }

    const fieldValue = formatRankField(rankData);
    embed.addFields({
      name: `${getRankEmoji(rankData.rank)} ${rankData.name}`,
      value: fieldValue,
      inline: true
    });
  }

  // Footer mit letztem Update
  const footerText = isDemo 
    ? `Demo-Daten • API nicht erreichbar`
    : `Zuletzt aktualisiert: ${formatTime(lastUpdated)} • rlapi.net`;
  
  embed.setFooter({
    text: footerText,
    iconURL: RL_LOGO
  });

  return embed;
}

/**
 * Formatiere den Feld-Wert für einen Rang
 * @param {Object} rankData - Rangdaten
 * @returns {string} Formatierter Text
 */
function formatRankField(rankData) {
  const lines = [];

  if (rankData.rank && rankData.rank !== "Unknown") {
    lines.push(`**Rang:** ${rankData.rank}`);
  }

  if (rankData.division && rankData.division !== "—") {
    lines.push(`**Division:** ${rankData.division}`);
  }

  if (rankData.mmr !== null && Number.isFinite(rankData.mmr)) {
    lines.push(`**MMR:** ${Math.round(rankData.mmr)}`);
  } else {
    lines.push("**MMR:** Keine Daten");
  }

  return lines.length > 0 ? lines.join("\n") : "Keine Daten verfügbar";
}

/**
 * Gebe einen Emoji für den Rang zurück
 * @param {string} rankName - Name des Ranges
 * @returns {string} Emoji
 */
function getRankEmoji(rankName) {
  if (!rankName) return "❓";

  if (rankName.includes("Bronze")) return "🥉";
  if (rankName.includes("Silver")) return "⚪";
  if (rankName.includes("Gold")) return "🟡";
  if (rankName.includes("Platinum")) return "💎";
  if (rankName.includes("Diamond")) return "💠";
  if (rankName.includes("Elite")) return "⭐";
  if (rankName.includes("Champion")) return "🏆";
  if (rankName.includes("Grand Champion")) return "👑";
  if (rankName.includes("Supersonic Legend")) return "🚀";

  return "🎮";
}

/**
 * Formatiere Zeitstempel als lesbare Zeichenkette
 * @param {Date} date - Datum
 * @returns {string} Formatiertes Datum
 */
function formatTime(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    return "Unbekannt";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffSeconds < 60) {
    return "gerade eben";
  }

  if (diffMinutes < 60) {
    return `vor ${diffMinutes} ${diffMinutes === 1 ? "Minute" : "Minuten"}`;
  }

  if (diffHours < 24) {
    return `vor ${diffHours} ${diffHours === 1 ? "Stunde" : "Stunden"}`;
  }

  return date.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
