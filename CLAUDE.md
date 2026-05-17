# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vinted marketplace scraper focused on NFL/NBA sports cards. Two modes:
1. **Single listing** — paste a Vinted URL, extract card metadata + AI photo analysis
2. **Catalog scrape** — bulk-scrape Vinted by searching all 32 NFL teams, match players, store in SQLite gallery

## Commands

```bash
cd backend
npm install          # install deps

node server.js       # start (port 8000)
node --watch server.js  # dev with auto-restart
```

Open `http://localhost:8000` (scraper) or `http://localhost:8000/gallery` (gallery).

## Environment

Copy `.env.example` → `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...   # required for /api/analyze-photo(s)
PORT=8000                      # optional
VINTED_COOKIE=_vinted_fr_session=...  # required for catalog scrape
```

`VINTED_COOKIE`: get from browser DevTools → Network → any `vinted.fr` request → Request Headers → `Cookie`. Expires with the session.

## Architecture

**No build step.** Pure ES modules (`"type": "module"` in package.json). `.env` is loaded manually in `server.js` (no dotenv dep).

### Backend modules

| File | Role |
|------|------|
| `server.js` | Express routes + .env loader + TEAM_ABBR map |
| `scraper.js` | Single item: tries `/api/v2/items/{id}` → `__NEXT_DATA__` → og meta fallback |
| `catalogScraper.js` | Bulk: HTML catalog pages → slug title-case → playerMatcher → upsert DB |
| `cardParser.js` | Regex extraction of player/team/year/series/variants from title string |
| `playerMatcher.js` | Levenshtein + token overlap fuzzy match against nflverse roster |
| `playerCache.js` | Fetches nflverse CSV (NFL) or Sleeper API (NBA), 24h in-memory cache |
| `db.js` | SQLite via better-sqlite3, WAL mode, `upsertCard` keyed on `vinted_id` |
| `photoAnalyzer.js` | Sends image URLs to `claude-haiku-4-5` vision, returns structured card info |

### Catalog scrape flow

1. `fetchCatalogItems(baseUrl, searchText, page)` — fetches HTML, extracts item `{id, title, url, photo_url, price}`:
   - **titles**: from URL slug (e.g. `/items/123-carte-nfl-phil-simms` → title-cased)
   - **photos**: `<link rel="preload" as="image">` tags — Vinted preloads exactly 1 per item, order matches item order
   - **prices**: grandparent DOM text near `<a href="/items/...">` — pattern `\d+[,.]?\d*\s*€`
2. Pre-filter by NFL keywords (slug), then `cardParser` + `playerMatcher` on title
3. `upsertCard` into SQLite — `ON CONFLICT(vinted_id) DO UPDATE`

**Vinted catalog uses React Server Components (RSC)** — no `__NEXT_DATA__` on catalog pages. Individual item pages still have `__NEXT_DATA__`.

**Catalog API (`/api/v2/catalog/items`) returns 401** even with session cookie — HTML scraping is the working approach.

### Team handling

`TEAM_ABBR` map in `server.js` and `catalogScraper.js` converts nflverse abbreviations (e.g. `CAR`, `NYG`) to nicknames (`Panthers`, `Giants`).

DB stores two fields: `team` (from card title slug) and `current_team` (from nflverse, abbreviation-expanded). Gallery shows both when they differ: `Giants → Eagles`.

### API endpoints

```
GET  /api/scrape?url=           → { listing, card, player_match }
POST /api/cards/save            → upsert from scrape result
GET  /api/cards?player&team&sport&page&limit
GET  /api/cards/filters         → { teams[], players[] }
GET  /api/catalog/check         → 503 if no VINTED_COOKIE/TOKEN, else { ok: true }
GET  /api/catalog/scrape?pages= → SSE stream of { done, saved, errors, total, message }
GET  /api/analyze-photo?url=
GET  /api/analyze-photos?url=   → multi-photo parallel analysis, merged result
```

### Frontend

Two standalone HTML files, no framework:
- `frontend/index.html` — single listing scraper + AI photo analysis
- `frontend/gallery.html` — card collection with sidebar filters, grid/list views, lightbox

`gallery.html` uses SSE (`EventSource`) for live scrape progress. Pre-checks auth via `/api/catalog/check` before opening the stream.
