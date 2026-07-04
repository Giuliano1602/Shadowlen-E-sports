const axios = require("axios");

const DEFAULT_SHOP_URL = "https://rlshop.gg/";
const DEFAULT_IMAGE_ORIGIN = "https://itemshop.gg";
const RLSHOP_ORIGIN = "https://rlshop.gg";
const PAINT_CODE_MAP = {
  "1": "Crimson",
  "2": "Lime",
  "3": "Black",
  "7": "Forest Green",
  "12": "Titanium White"
};

// Holt den aktuellen Rocket League Shop.
async function getShop() {
  try {
    const url = process.env.SHOP_API_URL || DEFAULT_SHOP_URL;
    const res = await axios.get(url, { timeout: 10000, responseType: "text" });

    if (!res.data) {
      throw new Error("Keine Shopdaten erhalten");
    }

    const parsedFromRlshop = transformRlshopPage(res.data, url);
    if (parsedFromRlshop) {
      return parsedFromRlshop;
    }

    const normalizedData = typeof res.data === "string" ? JSON.parse(res.data) : res.data;

    if (!normalizedData || typeof normalizedData !== "object") {
      throw new Error("Unbekanntes Shop-Format");
    }

    return transformShop(normalizedData, url);
  } catch (err) {
    console.error("Shop API Fehler:", err.message);
    return {
      date: new Date().toISOString(),
      items: [],
      featuredItems: [],
      dailyItems: [],
      sourceError: err.message
    };
  }
}

function transformRlshopPage(pageHtml, sourceUrl) {
  if (typeof pageHtml !== "string" || !pageHtml.includes("shopName:\"Featured Shop\"") || !pageHtml.includes("items:[{")) {
    return null;
  }

  const dateMatch = pageHtml.match(/lastUpdated:new Date\((\d+)\)/);
  const itemRegex = /\{thumbnail:"([^"]+)",label:"([^"]+)",category:"([^"]+)",price:"([^"]+)",paint:([^,]+),endTime:(\d+)\}/g;
  const featuredItems = [];

  let match = itemRegex.exec(pageHtml);
  while (match) {
    const [, thumbnail, label, category, price, paintRaw] = match;
    const paintCode = paintRaw && paintRaw !== "void 0" ? paintRaw.replace(/[^0-9]/g, "") : "";

    featuredItems.push({
      name: label,
      rarity: category,
      type: category,
      paint: paintCode ? (PAINT_CODE_MAP[paintCode] || `Paint ${paintCode}`) : null,
      price: Number(price),
      image: thumbnail.startsWith("http") ? thumbnail : `${RLSHOP_ORIGIN}${thumbnail}`,
      section: "featured"
    });

    match = itemRegex.exec(pageHtml);
  }

  if (!featuredItems.length) {
    return null;
  }

  return {
    date: dateMatch ? new Date(Number(dateMatch[1])).toISOString() : new Date().toISOString(),
    source: sourceUrl,
    items: [...featuredItems],
    featuredItems,
    dailyItems: []
  };
}

function transformShop(data, sourceUrl) {
  const featuredItems = normalizeItems(data.featured_items || data.featuredItems || [], "featured");
  const dailyItems = normalizeItems(data.daily_items || data.dailyItems || [], "daily");
  const legacyItems = normalizeItems(data.items || [], "daily");
  const items = featuredItems.length || dailyItems.length ? [...featuredItems, ...dailyItems] : legacyItems;

  return {
    date: data.date || data.updated_at || new Date().toISOString(),
    source: sourceUrl,
    items,
    featuredItems,
    dailyItems
  };
}

function normalizeItems(items, section) {
  return items.map((item) => ({
    name: item.name || "Unbenannt",
    rarity: item.rarity || item.type || "Unknown",
    type: item.type || null,
    paint: item.paint || null,
    price: item.price ?? null,
    image: resolveImageUrl(item.image),
    section
  }));
}

function resolveImageUrl(imageUrl) {
  if (!imageUrl) {
    return null;
  }

  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  if (imageUrl.startsWith("/")) {
    return `${DEFAULT_IMAGE_ORIGIN}${imageUrl}`;
  }

  return `${DEFAULT_IMAGE_ORIGIN}/${imageUrl}`;
}

function getBestImage(items) {
  const nonFallbackImage = items.find((item) => item.image && !item.image.includes("fallback.png"));

  return nonFallbackImage?.image || items.find((item) => item.image)?.image || null;
}

module.exports = {
  getShop,
  getBestImage
};
