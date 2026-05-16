import * as cheerio from "cheerio";
import { parseCard } from "./cardParser.js";
import { findPlayer } from "./playerMatcher.js";
import { upsertCard } from "./db.js";

const NFL_TEAMS = [
  "Cardinals", "Falcons", "Ravens", "Bills", "Panthers", "Bears",
  "Bengals", "Browns", "Cowboys", "Broncos", "Lions", "Packers",
  "Texans", "Colts", "Jaguars", "Chiefs", "Raiders", "Chargers",
  "Rams", "Dolphins", "Vikings", "Patriots", "Saints", "Giants",
  "Jets", "Eagles", "Steelers", "49ers", "Seahawks", "Buccaneers",
  "Titans", "Commanders",
];

const TEAM_ABBR = {
  ARI:"Cardinals", ATL:"Falcons", BAL:"Ravens", BUF:"Bills", CAR:"Panthers",
  CHI:"Bears", CIN:"Bengals", CLE:"Browns", DAL:"Cowboys", DEN:"Broncos",
  DET:"Lions", GB:"Packers", HOU:"Texans", IND:"Colts", JAX:"Jaguars",
  KC:"Chiefs", LA:"Rams", LAC:"Chargers", LV:"Raiders", MIA:"Dolphins",
  MIN:"Vikings", NE:"Patriots", NO:"Saints", NYG:"Giants", NYJ:"Jets",
  PHI:"Eagles", PIT:"Steelers", SF:"49ers", SEA:"Seahawks", TB:"Buccaneers",
  TEN:"Titans", WAS:"Commanders",
};

const NFL_KEYWORDS = new Set([
  "nfl", "football", "touchdown", "quarterback", "rookie", "panini",
  "topps", "donruss", "bowman", "prizm", "mosaic", "select",
  ...NFL_TEAMS.map(t => t.toLowerCase()),
]);

const HTML_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "Referer": "https://www.vinted.fr/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

// Fetch catalog page → return array of { id, title, url, photo_url }
async function fetchCatalogItems(baseUrl, searchText, page) {
  const params = new URLSearchParams({ search_text: searchText, page });
  const res = await fetch(`${baseUrl}/catalog?${params}`, {
    headers: HTML_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
  const html = await res.text();

  const $ = cheerio.load(html);
  const seen = new Set();
  const items = [];

  // Vinted preloads exactly 1 image per catalog item in <link rel="preload" as="image">
  // Order matches item order exactly — map by index
  const preloadImgs = [];
  $("link[rel='preload'][as='image']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.includes("vinted.net")) preloadImgs.push(href);
  });

  let itemIdx = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/items\/(\d+)(?:-([^?#]+))?/);
    if (!m) return;
    const id = m[1];
    if (seen.has(id)) return;
    seen.add(id);

    const rawSlug = m[2] ?? "";
    const titleLower = rawSlug.replace(/-/g, " ").trim();
    const title = titleLower.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    items.push({
      id,
      title,
      url: `${baseUrl}/items/${id}${rawSlug ? "-" + rawSlug : ""}`,
      photo_url: preloadImgs[itemIdx] ?? null,
    });
    itemIdx++;
  });

  return items;
}

function isNFLRelated(title) {
  const lower = title.toLowerCase();
  for (const kw of NFL_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

async function processItem(item) {
  const title = item.title ?? "";
  const description = item.description ?? "";
  const card = parseCard(title, description);
  const sport = (card.sport ?? "nfl").toLowerCase();
  const playerMatch = await findPlayer(card.player, sport);
  if (!playerMatch || playerMatch.confidence < 0.55) return null;

  const photos = extractPhotos(item.photos ?? [], item.photo);

  return {
    vinted_id:   String(item.id),
    title,
    player_name: playerMatch.full_name,
    team:        playerMatch.team   ?? card.team ?? null,
    position:    playerMatch.position ?? null,
    sport:       card.sport ?? "NFL",
    year:        card.year  ?? null,
    series:      card.series,
    variants:    card.variants,
    price:       item.price ?? null,
    currency:    item.currency ?? "EUR",
    photo_url:   photos[0] ?? null,
    photo_urls:  photos,
    vinted_url:  item.url ?? `https://www.vinted.fr/items/${item.id}`,
    confidence:  playerMatch.confidence,
  };
}

function extractPhotos(photosArr = [], singlePhoto) {
  const arr = photosArr.length ? photosArr : (singlePhoto ? [singlePhoto] : []);
  const urls = arr.flatMap(p => {
    for (const key of ["full_size_url", "high_resolution", "url", "thumb_url"]) {
      const v = p[key];
      if (!v) continue;
      const u = typeof v === "object" ? v.url : v;
      if (u) return [u.startsWith("http") ? u : "https://" + u];
    }
    return [];
  });
  const seen = new Set();
  return urls.filter(u => {
    const m = u.match(/\/t[c]?\/([^/]+)\//);
    if (!m) return true;
    if (seen.has(m[1])) return false;
    seen.add(m[1]);
    return true;
  });
}


export async function scrapeNFLCatalog({ baseUrl = "https://www.vinted.fr", maxPages = 3, onProgress } = {}) {
  const searchTerms = [
    "carte NFL",
    "NFL card",
    "NFL trading card",
    ...NFL_TEAMS.map(t => `carte nfl ${t}`),
  ];

  const seenId = new Set();
  let saved = 0, errors = 0, total = 0;

  for (const term of searchTerms) {
    for (let page = 1; page <= maxPages; page++) {
      let catalogItems;
      try {
        catalogItems = await fetchCatalogItems(baseUrl, term, page);
      } catch (err) {
        errors++;
        onProgress?.({ done: false, saved, errors, total, message: `Erreur catalog "${term}" p${page}: ${err.message}` });
        break;
      }

      if (!catalogItems.length) break;

      // Quick pre-filter via slug — avoid fetching pages for non-NFL items
      const newItems = catalogItems.filter(({ id, title }) => {
        if (seenId.has(id)) return false;
        seenId.add(id);
        return isNFLRelated(title);
      });

      if (!newItems.length) continue;
      total += newItems.length;
      onProgress?.({ done: false, saved, errors, total, message: `"${term}" p${page} — ${newItems.length} annonces NFL` });

      // Pre-filter by cardParser + playerMatcher using slug title
      const candidates = [];
      for (const { id, title, url, photo_url } of newItems) {
        const card = parseCard(title, "");
        const sport = (card.sport ?? "nfl").toLowerCase();
        const playerMatch = await findPlayer(card.player, sport);
        if (playerMatch && playerMatch.confidence >= 0.55) {
          candidates.push({ id, title, url, photo_url, card, playerMatch });
        }
      }

      if (!candidates.length) continue;
      onProgress?.({ done: false, saved, errors, total, message: `${candidates.length} joueurs identifiés — sauvegarde…` });

      // Save directly — photo_url already extracted from catalog HTML
      for (const { id, title, url, photo_url, card, playerMatch } of candidates) {
        try {
          upsertCard({
            vinted_id:   id,
            title,
            player_name: playerMatch.full_name,
            team:         card.team ?? null,
            current_team: TEAM_ABBR[playerMatch.team] ?? playerMatch.team ?? null,
            position:    playerMatch.position ?? null,
            sport:       card.sport ?? "NFL",
            year:        card.year  ?? null,
            series:      card.series,
            variants:    card.variants,
            price:       null,
            currency:    "EUR",
            photo_url:   photo_url ?? null,
            photo_urls:  photo_url ? [photo_url] : [],
            vinted_url:  url,
            confidence:  playerMatch.confidence,
          });
          saved++;
          onProgress?.({ done: false, saved, errors, total, message: `✓ ${playerMatch.full_name} — ${title.slice(0, 40)}` });
        } catch {
          errors++;
        }
      }
    }
  }

  onProgress?.({ done: true, saved, errors, total });
  return { saved, errors, total };
}
