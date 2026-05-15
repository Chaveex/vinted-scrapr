const NFL_TEAMS = new Set([
  "Cardinals","Falcons","Ravens","Bills","Panthers","Bears","Bengals","Browns",
  "Cowboys","Broncos","Lions","Packers","Texans","Colts","Jaguars","Chiefs",
  "Raiders","Chargers","Rams","Dolphins","Vikings","Patriots","Saints","Giants",
  "Jets","Eagles","Steelers","49ers","Seahawks","Buccaneers","Titans","Commanders",
  "Arizona","Atlanta","Baltimore","Buffalo","Carolina","Chicago","Cincinnati",
  "Cleveland","Dallas","Denver","Detroit","Green Bay","Houston","Indianapolis",
  "Jacksonville","Kansas City","Las Vegas","Los Angeles","Miami","Minnesota",
  "New England","New Orleans","New York","Philadelphia","Pittsburgh",
  "San Francisco","Seattle","Tampa Bay","Tennessee","Washington",
]);

const NBA_TEAMS = new Set([
  "Hawks","Celtics","Nets","Hornets","Bulls","Cavaliers","Mavericks","Nuggets",
  "Pistons","Warriors","Rockets","Pacers","Clippers","Lakers","Grizzlies","Heat",
  "Bucks","Timberwolves","Pelicans","Knicks","Thunder","Magic","76ers","Suns",
  "Trail Blazers","Kings","Spurs","Raptors","Jazz","Wizards",
  "Atlanta","Boston","Brooklyn","Charlotte","Chicago","Cleveland","Dallas",
  "Denver","Detroit","Golden State","Houston","Indiana","Los Angeles","Memphis",
  "Miami","Milwaukee","Minnesota","New Orleans","New York","Oklahoma City",
  "Orlando","Philadelphia","Phoenix","Portland","Sacramento","San Antonio",
  "Toronto","Utah","Washington",
]);

const CARD_VARIANTS = [
  "Orange","Green","Blue","Red","Gold","Silver","Purple","Pink","Black","White",
  "Rainbow","Prizm","Refractor","Holo","Holographic","Foil","Chrome","Optic",
  "Mosaic","Parallels","SSP","SP","Auto","Autograph","Patch","Jersey","Relic",
  "RPA","Base","Numbered",
];

const CARD_SERIES = [
  "Rising Stars","Score-a-Treat","Rated Rookie","Rookie","Prizm","Optic","Mosaic",
  "Select","Contenders","Panini","Topps","Bowman","Donruss","Score","Upper Deck",
  "Fleer","Draft Picks","Playoff","National Treasures","Immaculate","Spectra",
  "Absolute","Illusions","Chronicles","Luminance","RC",
];

export function parseCard(title = "", description = "") {
  const text = title + " " + description;
  const result = {
    sport: null, year: null, player: null, team: null,
    card_number: null, series: [], variants: [], lot_count: null,
  };

  // Sport
  for (const sport of ["NFL","NBA","NHL","MLB","MLS","UFC"]) {
    if (new RegExp(`\\b${sport}\\b`, "i").test(text)) {
      result.sport = sport;
      break;
    }
  }

  // Year
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) result.year = yearMatch[0];

  // Card number
  const numMatch = title.match(/#(\d+)/);
  if (numMatch) result.card_number = "#" + numMatch[1];
  else {
    const numberedMatch = title.match(/\/(\d+)\b/);
    if (numberedMatch) result.card_number = "/" + numberedMatch[1];
  }

  // Lot count
  const lotMatch = text.match(/\b(\d+)\s*cards?\s*(set|lot|pack)\b/i);
  if (lotMatch) result.lot_count = parseInt(lotMatch[1], 10);

  // Variants
  for (const v of CARD_VARIANTS) {
    if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`, "i").test(text)) {
      result.variants.push(v);
    }
  }

  // Series
  for (const s of CARD_SERIES) {
    if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`, "i").test(text)) {
      result.series.push(s);
    }
  }

  // Team — prefer longer matches
  const allTeams = result.sport === "NFL" ? NFL_TEAMS
    : result.sport === "NBA" ? NBA_TEAMS
    : new Set([...NFL_TEAMS, ...NBA_TEAMS]);

  for (const team of [...allTeams].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${team.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`, "i").test(text)) {
      result.team = team;
      break;
    }
  }

  result.player = extractPlayer(title, result);
  return result;
}

function extractPlayer(title, info) {
  let clean = title;
  for (const token of [info.sport, info.year, info.card_number, info.team, ...info.series, ...info.variants]) {
    if (token) clean = clean.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"), "gi"), " ");
  }
  clean = clean.replace(/\b(cards?|set|lot|pack|nfl|nba|nhl|mlb|and|the|of|a|an|vinted|#\d+|\/\d+|\d+)\b/gi, " ");
  clean = clean.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+|\s+Jr\.?|\s+Sr\.?|\s+III?|\s+II?){1,3})\b/g;
  const matches = [...clean.matchAll(namePattern)].map(m => m[1]);
  if (!matches.length) return null;
  return matches.reduce((a, b) => a.length >= b.length ? a : b);
}
