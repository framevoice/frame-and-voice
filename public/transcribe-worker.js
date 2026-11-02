// Frame & Voice speech-to-text worker.
// Runs OpenAI's open-source Whisper model inside the browser with Transformers.js.
// The audio never leaves the device; only the model files are downloaded (once, then cached).
import { pipeline, env } from "./vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/transformers/", self.location.href).href;

const SR = 16000;          // Whisper expects 16 kHz mono audio
const WIN = 30 * SR;        // Whisper works on 30-second windows
let asr = null, asrModel = null, asrDevice = null;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function hasWebGPU() {
  try { return !!(self.navigator.gpu && await self.navigator.gpu.requestAdapter()); } catch { return false; }
}

async function load(model, forceWasm) {
  if (asr && asrModel === model && !(forceWasm && asrDevice !== "wasm")) return;
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }
  const progress_callback = p => {
    if (p.status === "progress" || p.status === "initiate" || p.status === "done")
      post({ type: "loading", file: p.file, loaded: p.loaded || 0, total: p.total || 0, status: p.status });
  };
  const attempts = [];
  if (!forceWasm && await hasWebGPU()) attempts.push({ device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } });
  attempts.push({ device: "wasm", dtype: "q8" });
  let lastErr;
  for (const a of attempts) {
    try {
      asr = await pipeline("automatic-speech-recognition", model, { ...a, progress_callback });
      asrModel = model; asrDevice = a.device;
      post({ type: "ready", device: a.device });
      return;
    } catch (e) { lastErr = e; asr = null; }
  }
  throw lastErr;
}

// Find the quietest 100 ms between `from` and `to`, so windows are cut between words.
function quietest(audio, from, to) {
  const step = SR / 10; let best = to, bestE = Infinity;
  for (let s = Math.max(0, from); s + step <= to; s += step) {
    let e = 0; for (let i = s; i < s + step; i++) e += audio[i] * audio[i];
    if (e < bestE) { bestE = e; best = s + step / 2; }
  }
  return Math.floor(best);
}
function rms(a) { let e = 0; for (let i = 0; i < a.length; i += 4) e += a[i] * a[i]; return Math.sqrt(e / Math.max(1, a.length / 4)); }
const junk = t => !t || /^[\s\[\(].*[\]\)]\s*$/.test(t) || /^[\s.,!?♪-]*$/.test(t);

async function run({ audio, model, language }) {
  await load(model);
  const opts = { return_timestamps: true, task: "transcribe" };
  if (language && language !== "auto") opts.language = language;
  let pos = 0, lastText = "";
  while (pos < audio.length) {
    let end = Math.min(audio.length, pos + WIN);
    if (end < audio.length) end = quietest(audio, end - 6 * SR, end - SR);
    if (end - pos < SR) end = Math.min(audio.length, pos + WIN);
    const piece = audio.subarray(pos, end);
    const segs = [];
    if (rms(piece) > 0.004) {
      let out;
      try { out = await asr(piece, opts); }
      catch (err) {
        // Some graphics chips fail during processing; retry this window on the processor instead.
        if (asrDevice !== "webgpu") throw err;
        await load(model, true);
        out = await asr(piece, opts);
      }
      const offset = pos / SR;
      const chunks = out.chunks && out.chunks.length ? out.chunks : [{ timestamp: [0, null], text: out.text }];
      for (const c of chunks) {
        const text = (c.text || "").trim();
        if (junk(text) || text === lastText) continue;
        lastText = text;
        const s = (c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0) + offset;
        segs.push({ start: s, text });
      }
    }
    pos = end;
    post({ type: "segments", segs, done: pos / audio.length, at: pos / SR, device: asrDevice });
  }
  post({ type: "done" });
}

self.onmessage = async e => {
  if (e.data && e.data.type === "run") {
    try { await run(e.data); }
    catch (err) { post({ type: "error", message: String(err && err.message || err) }); }
  }
};
