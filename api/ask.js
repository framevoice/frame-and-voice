// Frame & Voice: answers a question about a recording using Groq's hosted AI models.
// Runs on Vercel as a serverless function. The Groq key stays here on the server
// (environment variable GROQ_API_KEY) and is never sent to the browser.
//
// Request:  POST /api/ask  {"question": "...", "context": "...", "title": "...", "partial": false}
// Response: plain text, streamed as it is written. Errors are JSON: {"error": "<code>"}.

const GROQ_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1") + "/chat/completions";
// Tried in order. When one model's free daily allowance is used up, the next one answers.
const MODELS = (process.env.GROQ_MODELS || "llama-3.3-70b-versatile,openai/gpt-oss-120b,llama-3.1-8b-instant")
  .split(",").map(s => s.trim()).filter(Boolean);

const MAX_QUESTION = 1000;     // characters
const MAX_CONTEXT = 16000;     // characters, about 4,000 tokens; keeps each request inside free-tier per-minute limits
const MAX_ANSWER_TOKENS = 700;

// Light protection against one person using up the shared allowance.
// (Per server instance only; Groq's own limits are the real ceiling.)
const PER_IP = 12, WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > PER_IP;
}

const SYSTEM = [
  "You answer questions about a video recording using only the timeline provided.",
  "Each timeline line starts with a timestamp, then what was on screen (if known), any note from the person who recorded it, and what was said.",
  "Cite timestamps like [03:12] for each point you make.",
  "If the timeline doesn't contain the answer, say so plainly instead of guessing.",
  "The transcript was produced automatically and has no speaker names, so don't attribute statements to named people unless the timeline names them.",
  "Write in clear British English. Be concise; use short bullet points where they help.",
].join(" ");

function sendError(res, status, code) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: code }));
}

function sameSite(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const from = req.headers.origin || req.headers.referer || "";
  if (!from) return false;
  try { return new URL(from).host === host; } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "method");
  if (!sameSite(req)) return sendError(res, 403, "origin");
  const key = process.env.GROQ_API_KEY;
  if (!key) return sendError(res, 503, "not_configured");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const question = body && typeof body.question === "string" ? body.question.trim() : "";
  const context = body && typeof body.context === "string" ? body.context : "";
  const title = body && typeof body.title === "string" ? body.title.slice(0, 200) : "Recording";
  if (!question || !context) return sendError(res, 400, "missing");
  if (question.length > MAX_QUESTION) return sendError(res, 413, "question_too_long");
  if (context.length > MAX_CONTEXT) return sendError(res, 413, "context_too_long");

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (tooMany(ip)) return sendError(res, 429, "slow_down");

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `TIMELINE of "${title}"${body.partial ? " (only the parts most related to the question)" : ""}:\n${context}\n\nQUESTION: ${question}` },
  ];

  let upstream = null, lastStatus = 0;
  for (const model of MODELS) {
    try {
      upstream = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, stream: true, temperature: 0.2, max_tokens: MAX_ANSWER_TOKENS }),
      });
    } catch { upstream = null; lastStatus = 502; continue; }
    if (upstream.ok) break;
    lastStatus = upstream.status;
    try { await upstream.text(); } catch {}
    upstream = null;
    // 429 = this model's free allowance is used up; 400/404 = model retired. Try the next one.
    if (![429, 400, 404, 413, 503].includes(lastStatus)) break;
  }
  if (!upstream) {
    if (lastStatus === 429) return sendError(res, 429, "daily_limit");
    if (lastStatus === 401 || lastStatus === 403) return sendError(res, 503, "bad_key");
    return sendError(res, 502, "upstream");
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  // Groq streams Server-Sent Events; pass on just the text.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch {}
      }
    }
  } catch {
    res.write("\n\n[The answer was cut off. Please ask again.]");
  }
  res.end();
};
