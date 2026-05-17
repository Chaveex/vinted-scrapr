import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { normalizeTeam } from "./teamNormalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// DATA_DIR env var → Railway persistent volume (mount at /data, set DATA_DIR=/data)
// Fallback: local data/ directory for dev
const DATA_DIR = process.env.DATA_DIR ?? resolve(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = resolve(DATA_DIR, "cards.db");
console.log(`[db] SQLite at ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vinted_id        TEXT    UNIQUE NOT NULL,
    title            TEXT    NOT NULL,
    player_name      TEXT,
    team             TEXT,
    position         TEXT,
    sport            TEXT    DEFAULT 'NFL',
    year             TEXT,
    series           TEXT,
    variants         TEXT,
    price            TEXT,
    currency         TEXT    DEFAULT 'EUR',
    photo_url        TEXT,
    photo_urls       TEXT,
    vinted_url       TEXT,
    confidence       REAL    DEFAULT 0,
    current_team     TEXT,
    card_fingerprint TEXT,
    listing_active   INTEGER DEFAULT 1,
    scraped_at       TEXT    DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_player ON cards(player_name);
  CREATE INDEX IF NOT EXISTS idx_team   ON cards(team);
  CREATE INDEX IF NOT EXISTS idx_sport  ON cards(sport);
`);

// Log card count on startup
try {
  const { n } = db.prepare(`SELECT COUNT(*) as n FROM cards`).get();
  console.log(`[db] ${n} cards in database`);
} catch { /* table not yet created */ }

// Non-destructive column migrations (existing DB)
for (const sql of [
  `ALTER TABLE cards ADD COLUMN current_team     TEXT`,
  `ALTER TABLE cards ADD COLUMN card_fingerprint TEXT`,
  `ALTER TABLE cards ADD COLUMN listing_active   INTEGER DEFAULT 1`,
]) {
  try { db.exec(sql); } catch { /* already exists */ }
}

// Index on card_fingerprint — must be after migration so column exists
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fingerprint ON cards(card_fingerprint)`); } catch { /* already exists */ }

// Normalize dirty team values
{
  const rows = db.prepare(`SELECT id, team, current_team FROM cards`).all();
  const update = db.prepare(`UPDATE cards SET team = ?, current_team = ? WHERE id = ?`);
  db.transaction(() => {
    for (const row of rows) {
      const t  = normalizeTeam(row.team);
      const ct = normalizeTeam(row.current_team);
      if (t !== row.team || ct !== row.current_team) update.run(t, ct, row.id);
    }
  })();
}

// Backfill fingerprints for existing rows
{
  const rows = db.prepare(`SELECT id, player_name, year, series, variants FROM cards WHERE card_fingerprint IS NULL`).all();
  if (rows.length) {
    const update = db.prepare(`UPDATE cards SET card_fingerprint = ? WHERE id = ?`);
    db.transaction(() => {
      for (const row of rows) {
        update.run(makeFingerprint({
          player_name: row.player_name,
          year:        row.year,
          series:      row.series  ? tryParse(row.series)  : null,
          variants:    row.variants ? tryParse(row.variants) : null,
        }), row.id);
      }
    })();
  }
}

function tryParse(s) { try { return JSON.parse(s); } catch { return s; } }

export function makeFingerprint(card) {
  const player   = (card.player_name ?? "").toLowerCase().trim();
  const year     = (card.year        ?? "").toLowerCase().trim();
  const series   = Array.isArray(card.series)
    ? [...card.series].sort().join(",").toLowerCase()
    : (card.series ?? "").toLowerCase();
  const variants = Array.isArray(card.variants)
    ? [...card.variants].sort().join(",").toLowerCase()
    : (card.variants ?? "").toLowerCase();
  return `${player}|${year}|${series}|${variants}`;
}

const stmtUpsert = db.prepare(`
  INSERT INTO cards
    (vinted_id, title, player_name, team, current_team, position, sport, year, series, variants,
     price, currency, photo_url, photo_urls, vinted_url, confidence, card_fingerprint, listing_active, scraped_at)
  VALUES
    (@vinted_id, @title, @player_name, @team, @current_team, @position, @sport, @year, @series, @variants,
     @price, @currency, @photo_url, @photo_urls, @vinted_url, @confidence, @card_fingerprint, 1, datetime('now'))
  ON CONFLICT(vinted_id) DO UPDATE SET
    title            = excluded.title,
    player_name      = excluded.player_name,
    team             = excluded.team,
    current_team     = excluded.current_team,
    position         = excluded.position,
    year             = excluded.year,
    series           = excluded.series,
    variants         = excluded.variants,
    price            = excluded.price,
    photo_url        = excluded.photo_url,
    photo_urls       = excluded.photo_urls,
    confidence       = excluded.confidence,
    card_fingerprint = excluded.card_fingerprint,
    listing_active   = 1,
    scraped_at       = datetime('now')
`);

// One card per fingerprint — best listing = active first, then lowest price, then highest confidence
const stmtList = db.prepare(`
  WITH ranked AS (
    SELECT *,
      COUNT(*)     OVER (PARTITION BY COALESCE(card_fingerprint, vinted_id)) AS listing_count,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(card_fingerprint, vinted_id)
        ORDER BY listing_active DESC, CAST(price AS REAL) ASC, confidence DESC
      ) AS rn
    FROM cards
    WHERE (:player IS NULL OR player_name LIKE :player)
      AND (:team   IS NULL OR team        LIKE :team)
      AND (:sport  IS NULL OR sport       =    :sport)
  )
  SELECT * FROM ranked WHERE rn = 1
  ORDER BY scraped_at DESC
  LIMIT :limit OFFSET :offset
`);

const stmtCount = db.prepare(`
  SELECT COUNT(DISTINCT COALESCE(card_fingerprint, vinted_id)) AS total
  FROM cards
  WHERE (:player IS NULL OR player_name LIKE :player)
    AND (:team   IS NULL OR team        LIKE :team)
    AND (:sport  IS NULL OR sport       =    :sport)
`);

const stmtTeams   = db.prepare(`SELECT DISTINCT team        FROM cards WHERE team        IS NOT NULL AND team        != '' ORDER BY team`);
const stmtPlayers = db.prepare(`SELECT DISTINCT player_name FROM cards WHERE player_name IS NOT NULL AND player_name != '' ORDER BY player_name`);

export function upsertCard(card) {
  return stmtUpsert.run({
    vinted_id:        card.vinted_id,
    title:            card.title        ?? "",
    player_name:      card.player_name  ?? null,
    team:             card.team         ?? null,
    current_team:     card.current_team ?? null,
    position:         card.position     ?? null,
    sport:            card.sport        ?? "NFL",
    year:             card.year         ?? null,
    series:           card.series       ? JSON.stringify(card.series)    : null,
    variants:         card.variants     ? JSON.stringify(card.variants)  : null,
    price:            card.price        ?? null,
    currency:         card.currency     ?? "EUR",
    photo_url:        card.photo_url    ?? null,
    photo_urls:       card.photo_urls   ? JSON.stringify(card.photo_urls) : null,
    vinted_url:       card.vinted_url   ?? null,
    confidence:       card.confidence   ?? 0,
    card_fingerprint: makeFingerprint(card),
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
  const rows  = stmtList.all(params);
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
    series:        row.series     ? JSON.parse(row.series)     : [],
    variants:      row.variants   ? JSON.parse(row.variants)   : [],
    photo_urls:    row.photo_urls ? JSON.parse(row.photo_urls) : (row.photo_url ? [row.photo_url] : []),
    listing_count: row.listing_count ?? 1,
    listing_active: row.listing_active ?? 1,
  };
}
