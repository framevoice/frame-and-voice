// Frame & Voice on-device question answering.
// Runs a small open-source language model in the browser (WebGPU) with Transformers.js.
// Nothing about the recording leaves the device; only the model files are downloaded (once, then cached).
import { pipeline, TextStreamer, env } from "./vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/transformers/", self.location.href).href;

// Tried in order; the second is a fallback if the first can't load on this machine.
const MODELS = [
  { id: "onnx-community/Llama-3.2-1B-Instruct-q4f16", dtype: "q4f16" },
  { id: "HuggingFaceTB/SmolLM2-1.7B-Instruct", dtype: "q4f16" },
];

let gen = null;
const post = msg => self.postMessage(msg);

async function load() {
  if (gen) return;
  let adapter = null;
  try { adapter = self.navigator.gpu && await self.navigator.gpu.requestAdapter(); } catch {}
  if (!adapter) throw new Error("NO_WEBGPU");
  const progress_callback = p => {
    if (p.status === "progress" || p.status === "initiate" || p.status === "done")
      post({ type: "loading", file: p.file, loaded: p.loaded || 0, total: p.total || 0, status: p.status });
  };
  let lastErr;
  for (const m of MODELS) {
    try {
      gen = await pipeline("text-generation", m.id, { device: "webgpu", dtype: m.dtype, progress_callback });
      post({ type: "ready", model: m.id });
      return;
    } catch (e) { lastErr = e; gen = null; }
  }
  throw lastErr;
}

self.onmessage = async e => {
  if (!e.data || e.data.type !== "ask") return;
  try {
    await load();
    const streamer = new TextStreamer(gen.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: text => { if (text) post({ type: "token", text }); },
    });
    await gen(e.data.messages, { max_new_tokens: 700, do_sample: false, repetition_penalty: 1.1, streamer });
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: String(err && err.message || err) });
  }
};
