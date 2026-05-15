import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import express from "express";
import { scrapeVintedItem } from "./scraper.js";
import { parseCard } from "./cardParser.js";
import { analyzeCardPhoto, analyzeCardPhotos } from "./photoAnalyzer.js";
import { findPlayer } from "./playerMatcher.js";

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
app.get("/", (_, res) => {
  res.sendFile(join(__dirname, "..", "frontend", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
});
