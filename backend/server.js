import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { scrapeVintedItem } from "./scraper.js";
import { parseCard } from "./cardParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8000;

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// API
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ detail: "Missing url parameter" });
  if (!url.includes("vinted.")) return res.status(400).json({ detail: "URL must be a Vinted listing" });

  try {
    const listing = await scrapeVintedItem(url);
    const card = parseCard(listing.title, listing.description);
    res.json({ listing, card });
  } catch (err) {
    const status = err.message.startsWith("HTTP") ? 502 : 422;
    res.status(status).json({ detail: err.message });
  }
});

// Frontend
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
});
