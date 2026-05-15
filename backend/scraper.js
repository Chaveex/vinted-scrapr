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

function ensureHttps(url) {
  if (!url) return url;
  return url.startsWith("http") ? url : "https://" + url;
}

function extractPhotos(photos = []) {
  return photos.flatMap(p => {
    for (const key of ["full_size_url", "url", "thumb_url"]) {
      if (p[key]) return [ensureHttps(p[key])];
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
    title: data.title ?? "",
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

function parseNextData(html) {
  const $ = cheerio.load(html);
  const script = $("#__NEXT_DATA__").html();
  if (!script) return null;
  try {
    return JSON.parse(script);
  } catch {
    return null;
  }
}

function findItemInNextData(nextData) {
  try {
    const pageProps = nextData?.props?.pageProps ?? {};
    for (const key of ["item", "itemDto", "listing"]) {
      if (pageProps[key]) return pageProps[key];
    }
    const initialState = pageProps.initialState ?? {};
    const items = initialState.items ?? {};
    const first = Object.values(items)[0];
    if (first) return first;
    return null;
  } catch {
    return null;
  }
}

function fallbackParse(html, url) {
  const $ = cheerio.load(html);
  const data = { url };

  const og = (name) => $(`meta[property="og:${name}"]`).attr("content");
  const metaName = (name) => $(`meta[name="${name}"]`).attr("content");

  const rawTitle = og("title") ?? metaName("title") ?? "";
  data.title = rawTitle.replace(/\s*[\|–-]\s*Vinted\s*$/i, "").trim();
  data.description = og("description") ?? metaName("description") ?? "";
  data.price = $(`meta[property="product:price:amount"]`).attr("content") ?? "";

  // JSON-LD
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

  // Collect all og:image tags
  if (!data.photos || !data.photos.length) {
    const ogImgs = $('meta[property="og:image"], meta[property="og:image:url"]')
      .map((_, el) => ({ url: $(el).attr("content") }))
      .get()
      .filter(p => p.url);
    if (ogImgs.length) data.photos = ogImgs;
  }

  // Fallback: find vinted CDN image URLs in raw HTML
  if (!data.photos || !data.photos.length) {
    const cdnPattern = /https:\/\/images\d*\.vinted\.net\/[^\s"']+\.(?:webp|jpg|jpeg|png)/g;
    const cdnMatches = [...new Set(html.match(cdnPattern) ?? [])];
    if (cdnMatches.length) data.photos = cdnMatches.map(u => ({ url: u }));
  }

  return data.title ? data : null;
}

export async function scrapeVintedItem(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Vinted`);
  const html = await res.text();

  const nextData = parseNextData(html);
  let itemData = nextData ? findItemInNextData(nextData) : null;

  if (!itemData) itemData = fallbackParse(html, url);
  if (!itemData) throw new Error("Could not extract item data from Vinted page");

  return mapItem(itemData, url);
}
