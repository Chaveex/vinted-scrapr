import { getPlayers, normalizeName } from "./playerCache.js";

// Levenshtein distance
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

// Token overlap: what fraction of query tokens appear in the candidate
function tokenOverlap(query, candidate) {
  const qt = normalizeName(query).split(" ").filter(Boolean);
  const ct = normalizeName(candidate).split(" ").filter(Boolean);
  if (!qt.length) return 0;
  const matches = qt.filter(t => ct.includes(t)).length;
  return matches / qt.length;
}

function extractSuffix(name) {
  const m = (name ?? "").match(/\b(jr\.?|sr\.?|ii|iii|iv)\b/i);
  return m ? m[1].replace(/\./g, "").toLowerCase() : "";
}

function score(queryRaw, queryNorm, player) {
  const candNorm = player._normalized;

  // Exact match after normalization
  if (queryNorm === candNorm) {
    // Disambiguate by suffix: "Marvin Harrison Jr" vs "Marvin Harrison"
    const querySuffix = extractSuffix(queryRaw);
    const playerSuffix = extractSuffix(player.full_name);
    if (querySuffix && playerSuffix) {
      return querySuffix === playerSuffix ? 1 : 0.75;
    }
    // Query has suffix but player doesn't (or vice versa) — penalize
    if (querySuffix && !playerSuffix) return 0.80;
    if (!querySuffix && playerSuffix) return 0.85;
    return 1;
  }

  const overlapFwd = tokenOverlap(queryNorm, candNorm);
  const overlapBwd = tokenOverlap(candNorm, queryNorm);
  const overlap = (overlapFwd + overlapBwd) / 2;
  const editSim = similarity(queryNorm, candNorm);

  let s = overlap * 0.6 + editSim * 0.4;

  // Suffix alignment bonus/penalty
  const querySuffix = extractSuffix(queryRaw);
  const playerSuffix = extractSuffix(player.full_name);
  if (querySuffix && playerSuffix) {
    s += querySuffix === playerSuffix ? 0.05 : -0.10;
  }

  // Active player small boost
  if (player.status === "Active" || player.status === "ACT") s += 0.01;

  return Math.max(0, Math.min(1, s));
}

export async function findPlayer(name, sport = "nfl") {
  if (!name) return null;

  const players = await getPlayers(sport);
  if (!players.length) return null;

  const queryNorm = normalizeName(name);
  if (!queryNorm) return null;

  let best = null;
  let bestScore = 0;

  for (const player of players) {
    const s = score(name, queryNorm, player);
    if (s > bestScore) {
      bestScore = s;
      best = player;
    }
  }

  if (!best || bestScore < 0.45) return null;

  return {
    full_name: best.full_name,
    team: best.team,
    position: best.position,
    status: best.status,
    confidence: Math.round(bestScore * 100) / 100,
    exact: bestScore >= 0.97,
  };
}
