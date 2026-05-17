import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeTeam } from "./teamNormalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "..", "data", "cards.db");

// Ensure data dir exists
import { mkdirSync } from "fs";
mkdirSync(resolve(__dirname, "..", "data"), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode — faster writes, safe concurrent reads
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    vinted_id     TEXT    UNIQUE NOT NULL,
    title         TEXT    NOT NULL,
    player_name   TEXT,
    team          TEXT,
    position      TEXT,
    sport         TEXT    DEFAULT 'NFL',
    year          TEXT,
    series        TEXT,
    variants      TEXT,
    price         TEXT,
    currency      TEXT    DEFAULT 'EUR',
    -- Store only the primary f800 URL as main photo (short string ~120 chars)
    -- Additional photos stored as JSON array of URLs (text, never binary)
    photo_url     TEXT,
    photo_urls    TEXT,
    vinted_url    TEXT,
    confidence    REAL    DEFAULT 0,
    current_team  TEXT,
    scraped_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_player ON cards(player_name);
  CREATE INDEX IF NOT EXISTS idx_team   ON cards(team);
  CREATE INDEX IF NOT EXISTS idx_sport  ON cards(sport);
`);

// Migration: add current_team if missing (non-destructive)
try { db.exec(`ALTER TABLE cards ADD COLUMN current_team TEXT`); } catch { /* already exists */ }

// Migration: normalize existing dirty team/current_team values
{
  const rows = db.prepare(`SELECT id, team, current_team FROM cards`).all();
  const update = db.prepare(`UPDATE cards SET team = ?, current_team = ? WHERE id = ?`);
  const run = db.transaction(() => {
    for (const row of rows) {
      const t  = normalizeTeam(row.team);
      const ct = normalizeTeam(row.current_team);
      if (t !== row.team || ct !== row.current_team) {
        update.run(t, ct, row.id);
      }
    }
  });
  run();
}

// Prepared statements
const stmtUpsert = db.prepare(`
  INSERT INTO cards
    (vinted_id, title, player_name, team, current_team, position, sport, year, series, variants,
     price, currency, photo_url, photo_urls, vinted_url, confidence, scraped_at)
  VALUES
    (@vinted_id, @title, @player_name, @team, @current_team, @position, @sport, @year, @series, @variants,
     @price, @currency, @photo_url, @photo_urls, @vinted_url, @confidence, datetime('now'))
  ON CONFLICT(vinted_id) DO UPDATE SET
    title        = excluded.title,
    player_name  = excluded.player_name,
    team         = excluded.team,
    current_team = excluded.current_team,
    position     = excluded.position,
    year         = excluded.year,
    series       = excluded.series,
    variants     = excluded.variants,
    price        = excluded.price,
    photo_url    = excluded.photo_url,
    photo_urls   = excluded.photo_urls,
    confidence   = excluded.confidence,
    scraped_at   = datetime('now')
`);

const stmtList = db.prepare(`
  SELECT * FROM cards
  WHERE (:player IS NULL OR player_name LIKE :player)
    AND (:team   IS NULL OR team        LIKE :team)
    AND (:sport  IS NULL OR sport       =    :sport)
  ORDER BY scraped_at DESC
  LIMIT :limit OFFSET :offset
`);

const stmtCount = db.prepare(`
  SELECT COUNT(*) as total FROM cards
  WHERE (:player IS NULL OR player_name LIKE :player)
    AND (:team   IS NULL OR team        LIKE :team)
    AND (:sport  IS NULL OR sport       =    :sport)
`);

const stmtTeams   = db.prepare(`SELECT DISTINCT team   FROM cards WHERE team   IS NOT NULL AND team   != '' ORDER BY team`);
const stmtPlayers = db.prepare(`SELECT DISTINCT player_name FROM cards WHERE player_name IS NOT NULL AND player_name != '' ORDER BY player_name`);

export function upsertCard(card) {
  return stmtUpsert.run({
    vinted_id:    card.vinted_id,
    title:        card.title        ?? "",
    player_name:  card.player_name  ?? null,
    team:         card.team         ?? null,
    current_team: card.current_team ?? null,
    position:     card.position     ?? null,
    sport:       card.sport        ?? "NFL",
    year:        card.year         ?? null,
    series:      card.series       ? JSON.stringify(card.series)   : null,
    variants:    card.variants     ? JSON.stringify(card.variants) : null,
    price:       card.price        ?? null,
    currency:    card.currency     ?? "EUR",
    photo_url:   card.photo_url    ?? null,
    photo_urls:  card.photo_urls   ? JSON.stringify(card.photo_urls) : null,
    vinted_url:  card.vinted_url   ?? null,
    confidence:  card.confidence   ?? 0,
  });
}

export function listCards({ player, team, sport, page = 1, limit = 48 } = {}) {
  const offset = (page - 1) * limit;
  const params = {
    player: player ? `%${player}%` : null,
    team:   team   ? `%${team}%`   : null,
    sport:  sport  ?? null,
    limit,
    offset,
  };
  const rows = stmtList.all(params);
  const { total } = stmtCount.get(params);

  return {
    cards: rows.map(parseRow),
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

export function getFilters() {
  return {
    teams:   stmtTeams.all().map(r => r.team),
    players: stmtPlayers.all().map(r => r.player_name),
  };
}

function parseRow(row) {
  return {
    ...row,
    series:    row.series    ? JSON.parse(row.series)    : [],
    variants:  row.variants  ? JSON.parse(row.variants)  : [],
    photo_urls: row.photo_urls ? JSON.parse(row.photo_urls) : (row.photo_url ? [row.photo_url] : []),
  };
}
