const SOURCES = {
  nfl: "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv",
  nba: "https://api.sleeper.app/v1/players/nba", // Sleeper kept for NBA
};

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

const cache = {
  nfl: { players: [], loadedAt: 0 },
  nba: { players: [], loadedAt: 0 },
};

export function normalizeName(name) {
  return (name ?? "")
    .toLowerCase()
    .replace(/[.\-']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Minimal CSV parser — handles quoted fields
function parseCSV(text) {
  const lines = text.split("\n");
  if (!lines.length) return [];

  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCSVLine(line);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cols[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === "," && !inQuote) { result.push(cur); cur = ""; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
}

function mapNflversePlayer(row) {
  const name = row.display_name?.trim();
  if (!name) return null;
  return {
    id: row.gsis_id ?? "",
    full_name: name,
    first_name: row.first_name ?? "",
    last_name: row.last_name ?? "",
    suffix: row.suffix ?? "",          // "Jr.", "Sr.", "III", etc.
    team: row.latest_team ?? "",
    position: row.position ?? "",
    status: row.status ?? "",
    sport: "nfl",
    rookie_season: row.rookie_season ?? "",
    last_season: row.last_season ?? "",
    draft_year: row.draft_year ?? "",
    _normalized: normalizeName(name),
  };
}

function mapSleeperPlayer(raw, sport) {
  const name = raw.full_name ?? `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim();
  if (!name) return null;
  return {
    id: raw.player_id ?? "",
    full_name: name,
    first_name: raw.first_name ?? "",
    last_name: raw.last_name ?? "",
    suffix: "",
    team: raw.team ?? "",
    position: raw.position ?? "",
    status: raw.status ?? "",
    sport,
    rookie_season: "",
    last_season: "",
    draft_year: String(raw.metadata?.rookie_year ?? ""),
    _normalized: normalizeName(name),
  };
}

async function loadNFL() {
  const now = Date.now();
  if (cache.nfl.players.length && now - cache.nfl.loadedAt < CACHE_TTL) return cache.nfl.players;

  try {
    console.log("[players] Loading NFL roster from nflverse (~25k players)…");
    const res = await fetch(SOURCES.nfl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    const players = rows.map(mapNflversePlayer).filter(Boolean);
    cache.nfl.players = players;
    cache.nfl.loadedAt = now;
    console.log(`[players] Loaded ${players.length} NFL players`);
    return players;
  } catch (err) {
    console.warn(`[players] NFL load failed: ${err.message}`);
    return cache.nfl.players;
  }
}

async function loadNBA() {
  const now = Date.now();
  if (cache.nba.players.length && now - cache.nba.loadedAt < CACHE_TTL) return cache.nba.players;

  try {
    console.log("[players] Loading NBA roster from Sleeper…");
    const res = await fetch(SOURCES.nba, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const players = Object.values(raw).map(p => mapSleeperPlayer(p, "nba")).filter(Boolean);
    cache.nba.players = players;
    cache.nba.loadedAt = now;
    console.log(`[players] Loaded ${players.length} NBA players`);
    return players;
  } catch (err) {
    console.warn(`[players] NBA load failed: ${err.message}`);
    return cache.nba.players;
  }
}

export async function getPlayers(sport = "nfl") {
  if (sport === "nfl") return loadNFL();
  if (sport === "nba") return loadNBA();
  return [];
}

// Preload NFL on startup (non-blocking)
loadNFL().catch(() => {});
