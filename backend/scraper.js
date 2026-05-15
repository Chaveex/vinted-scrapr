import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "DNT": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

const API_HEADERS = {
  ...HEADERS,
  "Accept": "application/json, text/plain, */*",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

function ensureHttps(url) {
  if (!url) return url;
  return url.startsWith("http") ? url : "https://" + url;
}

function extractItemId(url) {
  const match = url.match(/\/items\/(\d+)/);
  return match ? match[1] : null;
}

function extractBaseUrl(url) {
  const match = url.match(/^(https?:\/\/(?:www\.)?vinted\.\w+)/);
  return match ? match[1] : "https://www.vinted.fr";
}

function extractPhotos(photos = []) {
  return photos.flatMap(p => {
    // Prefer highest resolution available
    for (const key of ["full_size_url", "high_resolution", "url", "thumb_url"]) {
      if (p[key]) {
        const u = typeof p[key] === "object" ? p[key].url : p[key];
        if (u) return [ensureHttps(u)];
      }
    }
    return [];
  });
}

function extractSeller(user = {}) {
  if (!user?.login) return {};
  return {
    login: user.login,
    id: user.id,
    feedback_reputation: user.feedback_reputation ?? null,
    item_count: user.item_count ?? 0,
    profile_url: `https://www.vinted.fr/member/${user.id}`,
  };
}

function mapItem(data, url) {
  return {
    id: String(data.id ?? ""),
    title: (data.title ?? "").replace(/\s*[\|–-]\s*Vinted\s*$/i, "").trim(),
    description: data.description ?? "",
    price: data.price ?? "",
    currency: data.currency ?? "EUR",
    condition: data.status ?? data.item_status ?? "",
    brand: data.brand ?? data.brand_title ?? "",
    size: data.size_title ?? "",
    location: data.city ?? "",
    country: data.country ?? "",
    view_count: data.view_count ?? 0,
    favourite_count: data.favourite_count ?? 0,
    photos: extractPhotos(data.photos ?? []),
    seller: extractSeller(data.user),
    category_path: data.category_title ?? "",
    url: data.url ?? url,
  };
}

// Try Vinted internal API — returns clean structured JSON for the specific item
async function tryVintedApi(itemId, baseUrl) {
  try {
    const apiUrl = `${baseUrl}/api/v2/items/${itemId}`;
    const res = await fetch(apiUrl, { headers: API_HEADERS, redirect: "follow" });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.item ?? null;
  } catch {
    return null;
  }
}

// Parse __NEXT_DATA__ JSON — only used when API fails
function parseNextData(html) {
  const $ = cheerio.load(html);
  const script = $("#__NEXT_DATA__").html();
  if (!script) return null;
  try { return JSON.parse(script); } catch { return null; }
}

function findItemInNextData(nextData) {
  try {
    const pageProps = nextData?.props?.pageProps ?? {};
    for (const key of ["item", "itemDto", "listing"]) {
      if (pageProps[key]?.photos) return pageProps[key];
    }
    // Recursive search for first object with a photos array
    return findObjectWithPhotos(pageProps, 0);
  } catch { return null; }
}

function findObjectWithPhotos(obj, depth) {
  if (depth > 6 || !obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) return null;
  if (Array.isArray(obj.photos) && obj.photos.length > 0 && obj.title) return obj;
  for (const val of Object.values(obj)) {
    const found = findObjectWithPhotos(val, depth + 1);
    if (found) return found;
  }
  return null;
}

// All photos in a Vinted listing share the same numeric timestamp in the CDN URL:
// https://images1.vinted.net/t/{hash}/{size}/{timestamp}.webp
// Use the timestamp from the first known photo to filter only this listing's photos.
function extractListingPhotos(html, firstPhotoUrl) {
  const tsMatch = firstPhotoUrl?.match(/\/(\d{8,})\.\w+/);
  if (!tsMatch) return null;

  const timestamp = tsMatch[1];
  const pattern = new RegExp(
    `https://images\\d*\\.vinted\\.net/[^\\s"'<>\\\\]+/${timestamp}\\.\\w+(?:\\?[^\\s"'<>\\\\]*)?`,
    "g"
  );
  const allMatches = [...new Set(html.match(pattern) ?? [])];
  if (allMatches.length <= 1) return null;

  // Each photo has a unique hash segment — group by it and pick f800 (highest res)
  // URL structure: /t/{hash}/{size}/{timestamp}.ext
  const byHash = new Map();
  for (const url of allMatches) {
    const hashMatch = url.match(/\/t[c]?\/([^/]+)\//);
    if (!hashMatch) continue;
    const hash = hashMatch[1];
    const existing = byHash.get(hash);
    // Prefer f800 over other sizes
    if (!existing || url.includes("/f800/")) {
      byHash.set(hash, url);
    }
  }

  const deduped = [...byHash.values()];
  return deduped.length > 1 ? deduped.map(u => ({ url: u })) : null;
}

// Fallback: meta tags + timestamp-filtered CDN scan
function fallbackParseMeta(html, url) {
  const $ = cheerio.load(html);
  const data = { url };

  const og = (name) => $(`meta[property="og:${name}"]`).attr("content");
  const metaName = (name) => $(`meta[name="${name}"]`).attr("content");

  const rawTitle = og("title") ?? metaName("title") ?? "";
  data.title = rawTitle.replace(/\s*[\|–-]\s*Vinted\s*$/i, "").trim();
  data.description = og("description") ?? metaName("description") ?? "";
  data.price = $(`meta[property="product:price:amount"]`).attr("content") ?? "";

  // JSON-LD (listing-specific)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const ld = JSON.parse($(el).html() ?? "");
      if (["Product", "Offer"].includes(ld["@type"])) {
        data.title = data.title || (ld.name ?? "").replace(/\s*[\|–-]\s*Vinted\s*$/i, "").trim();
        data.description = data.description || ld.description || "";
        const price = ld.offers?.price;
        if (price) data.price = data.price || String(price);
        const imgs = Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : [];
        if (imgs.length) data.photos = imgs.map(u => ({ url: u }));
      }
    } catch { /* ignore */ }
  });

  // og:image — always scoped to current listing, use it as anchor for timestamp filter
  const ogImgs = $('meta[property="og:image"], meta[property="og:image:url"]')
    .map((_, el) => ({ url: $(el).attr("content") }))
    .get()
    .filter(p => p.url);

  if (!data.photos?.length && ogImgs.length) data.photos = ogImgs;

  // Use the first known photo's timestamp to find all sibling photos in the HTML
  const firstUrl = data.photos?.[0]?.url;
  if (firstUrl) {
    const allPhotos = extractListingPhotos(html, firstUrl);
    if (allPhotos) data.photos = allPhotos;
  }

  return data.title ? data : null;
}

export async function scrapeVintedItem(url) {
  const itemId = extractItemId(url);
  const baseUrl = extractBaseUrl(url);

  // 1. Try Vinted API directly — most reliable, returns only this item's photos
  if (itemId) {
    const apiData = await tryVintedApi(itemId, baseUrl);
    if (apiData) return mapItem(apiData, url);
  }

  // 2. Try __NEXT_DATA__ from HTML
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Vinted`);
  const html = await res.text();

  const nextData = parseNextData(html);
  const nextItem = nextData ? findItemInNextData(nextData) : null;
  if (nextItem) return mapItem(nextItem, url);

  // 3. Fallback: meta tags only (listing-scoped, no greedy CDN scan)
  const metaData = fallbackParseMeta(html, url);
  if (metaData) return mapItem(metaData, url);

  throw new Error("Could not extract item data from Vinted page");
}
