const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getShop } = require("../services/shopService");

function formatRelativeAge(dateValue) {
  const date = new Date(dateValue);
  const diffMs = Date.now() - date.getTime();

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return "just now";
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${Math.max(minutes, 1)}m ago`;
  }

  return `${hours}h ${minutes}m ago`;
}

function sortFeaturedItems(items) {
  return [...items].sort((a, b) => {
    const leftPrice = Number.isFinite(a.price) ? a.price : Number.MAX_SAFE_INTEGER;
    const rightPrice = Number.isFinite(b.price) ? b.price : Number.MAX_SAFE_INTEGER;

    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    return (a.name || "").localeCompare(b.name || "");
  });
}

function buildFeaturedEmbeds(shop, featuredItems) {
  const orderedItems = sortFeaturedItems(featuredItems);
  const headerEmbed = new EmbedBuilder()
    .setAuthor({ name: "rlshop.gg" })
    .setTitle("Rocket League Featured Shop")
    .setURL("https://rlshop.gg/")
    .setColor(0x1f2430)
    .setDescription(`Aktuelle Items: **${orderedItems.length}**`)
    .setFooter({ text: `last updated ${formatRelativeAge(shop.date)}` });

  const itemEmbeds = orderedItems.map((item, index) => {
    const detailParts = [item.type || item.rarity || "Unknown"];

    if (item.paint) {
      detailParts.unshift(item.paint);
    }

    const embed = new EmbedBuilder()
      .setColor(0x1f2430)
      .setTitle(`${index + 1}. ${item.name}`)
      .setDescription(`${detailParts.join(" • ")}\n💰 ${item.price ?? "?"} Credits`);

    if (item.image && !item.image.includes("fallback.png")) {
      embed.setThumbnail(item.image);
    }

    return embed;
  });

  return [headerEmbed, ...itemEmbeds];
}

function isInteractionResponseError(err) {
  return err && (err.code === 10062 || err.code === 40060);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Zeigt den aktuellen Rocket League Item Shop"),

  async execute(interaction) {
    try {
      await interaction.deferReply();
    } catch (err) {
      if (isInteractionResponseError(err)) {
        return;
      }
      throw err;
    }

    const shop = await getShop();
    const featuredItems = (shop.featuredItems || []).filter(Boolean);

    if (!featuredItems.length) {
      try {
        await interaction.editReply({
          content: "Zurzeit sind keine verifizierten Featured-Shopdaten verfuegbar."
        });
      } catch (err) {
        if (!isInteractionResponseError(err)) {
          throw err;
        }
      }
      return;
    }

    const embeds = buildFeaturedEmbeds(shop, featuredItems).slice(0, 10);

    try {
      await interaction.editReply({ embeds });
    } catch (err) {
      if (!isInteractionResponseError(err)) {
        throw err;
      }
    }
  }
};
