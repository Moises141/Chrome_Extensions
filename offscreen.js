import { pipeline, env } from "./transformers.min.js";

// Optimization for extension environments and Brave consistency
env.allowLocalModels = false;  // Force remote Hub to avoid local search fails
env.allowRemoteModels = true;
env.useBrowserCache = true;    // Use IndexedDB for model caching (works in MV3)
env.backends.onnx.wasm.numThreads = 1; // Stability on low-resource or restricted contexts

// Suppress noisy ONNX Runtime warnings (Removing initializer... etc)
env.backends.onnx.logSeverityLevel = 3; // 0:Verbose, 1:Info, 2:Warning, 3:Error

let transcriber = null;
let currentModelName = "";

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== "offscreen") return;
  
  const { id, type, payload } = msg;
  console.log(`Offscreen: Received [${type}]`);
  
  const reply = (t, p) => chrome.runtime.sendMessage({ target: "background", id, type: t, payload: p });

  if (type === "LOAD_MODEL") {
    const requestedModel = payload?.modelName || "Xenova/whisper-base.en";
    
    if (transcriber && currentModelName === requestedModel) { 
      reply("MODEL_LOADED"); 
      return; 
    }
    
    try {
      console.log(`Offscreen: Loading model [${requestedModel}]...`);
      reply("MODEL_LOADING_START");
      
      // Clear old model if switching
      transcriber = null;
      currentModelName = requestedModel;

      let lastProgressTime = 0;
      transcriber = await pipeline("automatic-speech-recognition", requestedModel, {
        dtype: "q8",
        progress_callback: (prog) => {
          const now = Date.now();
          if (now - lastProgressTime > 100 || prog.status === 'done') {
            reply("MODEL_PROGRESS", prog);
            lastProgressTime = now;
          }
        }
      });
      console.log("Offscreen: Pipeline ready.");
      reply("MODEL_LOADED");
    } catch (e) {
      console.error("Offscreen: Model load error:", e);
      reply("ERROR", { message: e.message });
    }
  }
  
  if (type === "TRANSCRIBE") {
    try {
      console.log("Offscreen: Transcription starting...");
      reply("TRANSCRIBE_START");
      
      let audio = payload.audioData;
      if (!(audio instanceof Float32Array)) {
          // Flatten if it's a plain search component from messaging
          audio = Float32Array.from(Object.values(audio));
      }

      const start = performance.now();
      const result = await transcriber(audio, {
        sampling_rate: 16000,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: "english",
        task: "transcribe",
        return_timestamps: false,
      });
      const duration = (performance.now() - start).toFixed(1);
      console.log(`Offscreen: Transcription finished in ${duration}ms`);
      
      reply("TRANSCRIBE_DONE", { text: result.text?.trim() ?? "" });
    } catch (e) {
      console.error("Offscreen: Transcription error:", e);
      reply("ERROR", { message: e.message });
    }
  }
});
