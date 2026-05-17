// Canonical NFL team nicknames — single source of truth
export const NFL_CANONICAL_TEAMS = [
  "Cardinals", "Falcons", "Ravens", "Bills", "Panthers", "Bears",
  "Bengals", "Browns", "Cowboys", "Broncos", "Lions", "Packers",
  "Texans", "Colts", "Jaguars", "Chiefs", "Raiders", "Chargers",
  "Rams", "Dolphins", "Vikings", "Patriots", "Saints", "Giants",
  "Jets", "Eagles", "Steelers", "49ers", "Seahawks", "Buccaneers",
  "Titans", "Commanders",
];

// All known variants → canonical nickname
const TEAM_MAP = {
  // Cardinals
  ari: "Cardinals", arizona: "Cardinals", "arizona cardinals": "Cardinals",
  // Falcons
  atl: "Falcons", atlanta: "Falcons", "atlanta falcons": "Falcons",
  // Ravens
  bal: "Ravens", baltimore: "Ravens", "baltimore ravens": "Ravens",
  // Bills
  buf: "Bills", buffalo: "Bills", "buffalo bills": "Bills",
  // Panthers
  car: "Panthers", carolina: "Panthers", "carolina panthers": "Panthers",
  // Bears
  chi: "Bears", chicago: "Bears", "chicago bears": "Bears",
  // Bengals
  cin: "Bengals", cincinnati: "Bengals", "cincinnati bengals": "Bengals",
  // Browns
  cle: "Browns", cleveland: "Browns", "cleveland browns": "Browns",
  // Cowboys
  dal: "Cowboys", dallas: "Cowboys", "dallas cowboys": "Cowboys",
  // Broncos
  den: "Broncos", denver: "Broncos", "denver broncos": "Broncos",
  // Lions
  det: "Lions", detroit: "Lions", "detroit lions": "Lions",
  // Packers
  gb: "Packers", "green bay": "Packers", "green bay packers": "Packers",
  // Texans
  hou: "Texans", houston: "Texans", "houston texans": "Texans",
  // Colts
  ind: "Colts", indianapolis: "Colts", "indianapolis colts": "Colts",
  // Jaguars
  jax: "Jaguars", jacksonville: "Jaguars", "jacksonville jaguars": "Jaguars",
  // Chiefs
  kc: "Chiefs", "kansas city": "Chiefs", "kansas city chiefs": "Chiefs",
  // Raiders
  lv: "Raiders", "las vegas": "Raiders", "las vegas raiders": "Raiders",
  oak: "Raiders", oakland: "Raiders", "oakland raiders": "Raiders",
  // Chargers
  lac: "Chargers", "los angeles chargers": "Chargers", "la chargers": "Chargers",
  "san diego": "Chargers", "san diego chargers": "Chargers",
  // Rams
  la: "Rams", "los angeles rams": "Rams", "la rams": "Rams",
  "st. louis": "Rams", "st louis": "Rams", "st. louis rams": "Rams",
  // Dolphins
  mia: "Dolphins", miami: "Dolphins", "miami dolphins": "Dolphins",
  // Vikings
  min: "Vikings", minnesota: "Vikings", "minnesota vikings": "Vikings",
  // Patriots
  ne: "Patriots", "new england": "Patriots", "new england patriots": "Patriots",
  // Saints
  no: "Saints", "new orleans": "Saints", "new orleans saints": "Saints",
  // Giants
  nyg: "Giants", "new york giants": "Giants", "ny giants": "Giants",
  // Jets
  nyj: "Jets", "new york jets": "Jets", "ny jets": "Jets",
  // Eagles
  phi: "Eagles", philadelphia: "Eagles", "philadelphia eagles": "Eagles",
  // Steelers
  pit: "Steelers", pittsburgh: "Steelers", "pittsburgh steelers": "Steelers",
  // 49ers
  sf: "49ers", "san francisco": "49ers", "san francisco 49ers": "49ers",
  "sf 49ers": "49ers",
  // Seahawks
  sea: "Seahawks", seattle: "Seahawks", "seattle seahawks": "Seahawks",
  // Buccaneers
  tb: "Buccaneers", "tampa bay": "Buccaneers", "tampa bay buccaneers": "Buccaneers",
  // Titans
  ten: "Titans", tennessee: "Titans", "tennessee titans": "Titans",
  // Commanders
  was: "Commanders", washington: "Commanders", "washington commanders": "Commanders",
  "washington football team": "Commanders", "washington redskins": "Commanders",
  redskins: "Commanders",
};

// Add canonical names as self-mappings (e.g. "Giants" → "Giants")
for (const name of NFL_CANONICAL_TEAMS) {
  TEAM_MAP[name.toLowerCase()] = name;
}

export function normalizeTeam(team) {
  if (!team) return null;
  const key = team.trim().toLowerCase();
  return TEAM_MAP[key] ?? null;
}
