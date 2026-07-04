const cron = require("node-cron");
const { getShop } = require("./shopService");
const { EmbedBuilder, ChannelType } = require("discord.js");

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

function chunkEmbeds(embeds, chunkSize = 10) {
  const chunks = [];
  for (let i = 0; i < embeds.length; i += chunkSize) {
    chunks.push(embeds.slice(i, i + chunkSize));
  }
  return chunks;
}

async function postFeaturedShop(client, reason) {
  const shop = await getShop();
  const featuredItems = (shop.featuredItems || []).filter(Boolean);

  const channelId = process.env.SHOP_CHANNEL_ID || "1508937810563043470";
  const channel = client.channels.cache.get(channelId);

  if (!channel || channel.type !== ChannelType.GuildText) {
    console.warn(`Shop-Channel nicht gefunden oder kein Textkanal: ${channelId}`);
    return;
  }

  if (!featuredItems.length) {
    console.log(`Kein Featured Shop vorhanden, kein Post wird gesendet (${reason}).`);
    return;
  }

  const embeds = buildFeaturedEmbeds(shop, featuredItems);
  const batches = chunkEmbeds(embeds, 10);

  for (const batch of batches) {
    await channel.send({ embeds: batch });
  }

  console.log(`Featured Shop gesendet (${reason}) in Kanal ${channelId}.`);
}

function startScheduler(client) {
  const cronExpression = process.env.SHOP_CRON || "0 21 * * *";

  // Beim Start einmal sofort posten.
  postFeaturedShop(client, "startup").catch((err) => {
    console.error("Fehler beim initialen Shop-Post:", err.message);
  });

  cron.schedule(cronExpression, async () => {
    console.log("Taeglicher Featured Shop Update-Job laeuft...");

    try {
      await postFeaturedShop(client, "scheduled");
    } catch (err) {
      console.error("Fehler beim geplanten Shop-Post:", err.message);
    }
  }, {
    timezone: "Europe/Berlin"
  });
}

module.exports = { startScheduler };
