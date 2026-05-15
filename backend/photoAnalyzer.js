import Anthropic from "@anthropic-ai/sdk";

// Client created lazily so .env is loaded before first use
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
  "confidence": "high | medium | low — your confidence in the overall extraction"
}`;

export async function analyzeCardPhoto(imageUrl) {
  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: imageUrl },
          },
          {
            type: "text",
            text: USER_PROMPT,
          },
        ],
      },
    ],
  });

  const text = response.content[0]?.text ?? "";
  try {
    // Strip markdown fences if model adds them anyway
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Model returned unparseable response: ${text.slice(0, 200)}`);
  }
}
