import Anthropic from "@anthropic-ai/sdk";

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const SYSTEM_PROMPT = `You are a sports trading card expert.
Analyze ONLY what is visually printed on the card in the image.
Do NOT use any context, filename, URL, or external knowledge beyond what the card itself shows.
Respond in JSON only — no prose, no markdown fences.`;

const USER_PROMPT = `Look at this trading card image and extract what is physically printed on it.
Return a JSON object with exactly these keys:
{
  "player": "full player name as printed on card, or null",
  "team": "team name as printed on card, or null",
  "year": "year or season printed on card (e.g. '2024' or '2023-24'), or null",
  "series": "card set or series name as printed (e.g. 'Prizm', 'Rising Stars', 'Donruss'), or null",
  "card_number": "card number as printed (e.g. '#38' or '38/150'), or null",
  "variant": "parallel or variant name visible (e.g. 'Orange', 'Gold Refractor'), or null",
  "sport": "NFL, NBA, NHL, MLB or null — infer only from logos/text on card",
  "side": "front | back | unknown — which side of the card is this",
  "confidence": "high | medium | low — your confidence in the overall extraction"
}`;

async function analyzeSingle(imageUrl) {
  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: imageUrl } },
        { type: "text", text: USER_PROMPT },
      ],
    }],
  });

  const text = response.content[0]?.text ?? "";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned);
}

// Analyze a single photo
export async function analyzeCardPhoto(imageUrl) {
  try {
    return await analyzeSingle(imageUrl);
  } catch (e) {
    throw new Error(`Model returned unparseable response: ${e.message}`);
  }
}

// Analyze multiple photos in parallel and merge
export async function analyzeCardPhotos(imageUrls) {
  const results = await Promise.all(
    imageUrls.map(async (url, i) => {
      try {
        const data = await analyzeSingle(url);
        return { ...data, photoIndex: i, url, error: null };
      } catch (e) {
        return { photoIndex: i, url, error: e.message };
      }
    })
  );

  const valid = results.filter(r => !r.error);
  const merged = valid.length ? mergeResults(valid) : null;

  return { results, merged };
}

const CONF_RANK = { high: 3, medium: 2, low: 1 };
const FIELDS = ["player", "team", "year", "series", "card_number", "variant", "sport"];

function mergeResults(results) {
  const merged = {};

  for (const field of FIELDS) {
    const candidates = results
      .filter(r => r[field])
      .map(r => ({ val: r[field], rank: CONF_RANK[r.confidence] ?? 1, photoIndex: r.photoIndex }));

    if (!candidates.length) { merged[field] = null; continue; }

    // Count value occurrences weighted by confidence
    const scores = {};
    for (const c of candidates) {
      const key = c.val.toLowerCase();
      scores[key] = (scores[key] || { val: c.val, score: 0 });
      scores[key].score += c.rank;
    }
    merged[field] = Object.values(scores).sort((a, b) => b.score - a.score)[0].val;
  }

  // Aggregate confidence
  const ranks = results.map(r => CONF_RANK[r.confidence] ?? 1);
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  merged.confidence = avg >= 2.5 ? "high" : avg >= 1.5 ? "medium" : "low";
  merged.photoCount = results.length;

  return merged;
}
