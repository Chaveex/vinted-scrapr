import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import express from "express";
import { scrapeVintedItem } from "./scraper.js";
import { parseCard } from "./cardParser.js";
import { analyzeCardPhoto, analyzeCardPhotos } from "./photoAnalyzer.js";
import { findPlayer } from "./playerMatcher.js";
import { upsertCard, listCards, getFilters } from "./db.js";
import { scrapeNFLCatalog } from "./catalogScraper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no external dep needed)
try {
  const lines = readFileSync(resolve(__dirname, "..", ".env"), "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch { /* .env is optional */ }

const TEAM_ABBR = {
  ARI:"Cardinals", ATL:"Falcons", BAL:"Ravens", BUF:"Bills", CAR:"Panthers",
  CHI:"Bears", CIN:"Bengals", CLE:"Browns", DAL:"Cowboys", DEN:"Broncos",
  DET:"Lions", GB:"Packers", HOU:"Texans", IND:"Colts", JAX:"Jaguars",
  KC:"Chiefs", LA:"Rams", LAC:"Chargers", LV:"Raiders", MIA:"Dolphins",
  MIN:"Vikings", NE:"Patriots", NO:"Saints", NYG:"Giants", NYJ:"Jets",
  PHI:"Eagles", PIT:"Steelers", SF:"49ers", SEA:"Seahawks", TB:"Buccaneers",
  TEN:"Titans", WAS:"Commanders",
};

const app = express();
const PORT = process.env.PORT || 8000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ detail: "Missing url parameter" });
  if (!url.includes("vinted.")) return res.status(400).json({ detail: "URL must be a Vinted listing" });

  try {
    const listing = await scrapeVintedItem(url);
    const card = parseCard(listing.title, listing.description);

    // Fuzzy-match player name against Sleeper roster
    const sport = (card.sport ?? "nfl").toLowerCase();
    const playerMatch = await findPlayer(card.player, sport);

    res.json({ listing, card, player_match: playerMatch });
  } catch (err) {
    const status = err.message.startsWith("HTTP") ? 502 : 422;
    res.status(status).json({ detail: err.message });
  }
});

// --- Cards DB endpoints ---

// List cards with filters
app.get("/api/cards", (req, res) => {
  const { player, team, sport, page, limit } = req.query;
  const result = listCards({
    player: player || undefined,
    team:   team   || undefined,
    sport:  sport  || undefined,
    page:   parseInt(page)  || 1,
    limit:  Math.min(parseInt(limit) || 48, 200),
  });
  res.json(result);
});

app.get("/api/cards/filters", (_, res) => res.json(getFilters()));

app.post("/api/cards/save", express.json(), (req, res) => {
  const { listing, card, player_match } = req.body ?? {};
  if (!listing?.id) return res.status(400).json({ detail: "Missing listing.id" });
  upsertCard({
    vinted_id:   listing.id,
    title:       listing.title,
    player_name: player_match?.full_name ?? card?.player,
    team:         card?.team ?? null,
    current_team: TEAM_ABBR[player_match?.team] ?? player_match?.team ?? null,
    position:    player_match?.position,
    sport:       card?.sport ?? "NFL",
    year:        card?.year,
    series:      card?.series,
    variants:    card?.variants,
    price:       listing.price,
    currency:    listing.currency,
    photo_url:   listing.photos?.[0] ?? null,
    photo_urls:  listing.photos ?? [],
    vinted_url:  listing.url,
    confidence:  player_match?.confidence ?? 0,
  });
  res.json({ ok: true });
});

// Catalog auth check — fast endpoint to verify token before opening SSE
app.get("/api/catalog/check", (_, res) => {
  if (!process.env.VINTED_TOKEN && !process.env.VINTED_COOKIE) {
    return res.status(503).json({ detail: "Auth manquante. Ajoute VINTED_COOKIE dans .env (cookie de session vinted.fr)" });
  }
  res.json({ ok: true });
});

// Catalog scrape — SSE stream for live progress
app.get("/api/catalog/scrape", async (req, res) => {
  if (!process.env.VINTED_TOKEN && !process.env.VINTED_COOKIE) {
    return res.status(503).json({
      detail: "Auth manquante. Ouvre vinted.fr → F12 → Network → copie le Cookie header d'un appel api/v2/ → colle dans .env comme VINTED_COOKIE"
    });
  }
  const rawPages = req.query.pages !== undefined ? parseInt(req.query.pages) : 3;
  const maxPages = Math.min(isNaN(rawPages) ? 3 : Math.max(0, rawPages), 20);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  try {
    await scrapeNFLCatalog({ maxPages, onProgress: send });
  } catch (err) {
    send({ done: true, error: err.message });
  }
  res.end();
});

// Analyze multiple photos in parallel → merged result
app.get("/api/analyze-photos", async (req, res) => {
  let urls = req.query.url;
  if (!urls) return res.status(400).json({ detail: "Missing url parameter" });
  if (!Array.isArray(urls)) urls = [urls];
  urls = urls.filter(u => u.startsWith("http")).slice(0, 8); // max 8 photos

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ detail: "ANTHROPIC_API_KEY not configured — add it to .env" });
  }

  try {
    const result = await analyzeCardPhotos(urls);
    res.json(result);
  } catch (err) {
    res.status(502).json({ detail: err.message });
  }
});

app.get("/api/analyze-photo", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).json({ detail: "Missing url parameter" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ detail: "ANTHROPIC_API_KEY not configured — add it to .env" });
  }

  try {
    const result = await analyzeCardPhoto(imageUrl);
    res.json(result);
  } catch (err) {
    res.status(502).json({ detail: err.message });
  }
});

app.use(express.static(join(__dirname, "..", "frontend")));
app.get("/", (_, res) => res.sendFile(join(__dirname, "..", "frontend", "index.html")));
app.get("/gallery", (_, res) => res.sendFile(join(__dirname, "..", "frontend", "gallery.html")));

app.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
});
