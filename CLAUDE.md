# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vinted marketplace scraper focused on sports cards (NFL/NBA). Scrapes a Vinted listing URL and extracts + parses card metadata (player, team, year, series, variants).

## Stack

- **Runtime:** Node.js 24+
- **Backend:** Express 4 · Cheerio (HTML parsing) · native `fetch`
- **Frontend:** Vanilla HTML/CSS/JS (no framework) — single file `frontend/index.html`
- **Scraping:** Native `fetch` with browser headers → `__NEXT_DATA__` JSON extraction → og meta / CDN regex fallback

## Structure

```
backend/
  server.js       # Express app, /api/scrape endpoint, serves frontend
  scraper.js      # Vinted page fetcher + __NEXT_DATA__ parser + fallbacks
  cardParser.js   # Regex-based card info extractor (player/team/year/series/variants)
  package.json
frontend/
  index.html      # Full SPA served at /
```

## Install

```bash
cd backend
npm install
```

## Run

```bash
cd backend
node server.js          # production
node --watch server.js  # dev (auto-restart)
```

Open `http://localhost:8000` in browser.

## API

```
GET /api/scrape?url=<vinted_url>
GET /api/analyze-photo?url=<image_url>   — requires ANTHROPIC_API_KEY
```

`/api/scrape` returns:
```json
{
  "listing": { "title", "price", "photos", "description", "seller", ... },
  "card":    { "sport", "year", "player", "team", "card_number", "series", "variants", "lot_count" }
}
```

`/api/analyze-photo` returns:
```json
{
  "player", "team", "year", "series", "card_number", "variant", "sport",
  "confidence": "high | medium | low"
}
```

## Architecture notes

- Scraper looks for `<script id="__NEXT_DATA__">` (Vinted uses Next.js) → structured item JSON.
- Fallback: parse `og:*` meta tags + JSON-LD if `__NEXT_DATA__` unavailable.
- Card parser uses regex patterns + known team name lists (NFL + NBA) against title + description.
- Photo analyzer sends image to `claude-haiku-4-5` vision — extracts info from what's PRINTED on the card only, ignoring listing text.
- Frontend cross-validates AI vision result vs regex-parsed title.
- No DB, no auth, no state — pure stateless scrape-on-request.

## Environment variables

```
ANTHROPIC_API_KEY=sk-ant-...   # required for /api/analyze-photo
PORT=8000                      # optional, default 8000
```

Copy `.env.example` → `.env` and fill in the key.
