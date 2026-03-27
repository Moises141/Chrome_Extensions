// content.js — VoiceBox floating toolbar
// Uses Shadow DOM for complete CSS isolation from the host page.

(function () {
  "use strict";

  if (window.__voiceboxInjected) return;
  window.__voiceboxInjected = true;

  // ─── State ─────────────────────────────────────────────────────────────────

  const State = {
    IDLE: "idle",
    LOADING_MODEL: "loading_model",
    READY: "ready",
    RECORDING: "recording",
    PROCESSING: "processing",
    ERROR: "error",
  };

  let state = State.IDLE;
  let mediaRecorder = null;
  let audioChunks = [];
  let audioContext = null;
  let stream = null;
  let modelLoadProgress = 0;
  let lastError = "";
  let hostEl = null;
  let shadow = null;
  let toolbar = null;
  let isVisible = false;
  let isSettingsVisible = false;
  let isMinimized = false;
  let isPinned = false;
  let msgIdCounter = 0;
  let pendingCallbacks = {};
  let lastFocusedElement = null;
  let timerInterval = null;
  let recordingStartTime = 0;

  const Config = {
    clipboardFallback: true,
    modelName: "Xenova/whisper-base.en",
  };
  
  async function loadConfig() {
    const res = await chrome.storage.local.get(["clipboardFallback", "modelName"]);
    if (res.clipboardFallback !== undefined) Config.clipboardFallback = res.clipboardFallback;
    if (res.modelName !== undefined) Config.modelName = res.modelName;
  }

  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
      if (!hostEl || !hostEl.contains(el)) {
        lastFocusedElement = el;
      }
    }
  }, true);

  // ─── Background Connection ──────────────────────────────────────────────────

  let bgPort = null;
  
  function connectBackground() {
    if (bgPort) return;
    console.log("VoiceBox: Connecting to background...");
    bgPort = chrome.runtime.connect({ name: "voicebox" });
    bgPort.onMessage.addListener(handleWorkerMessage);
    bgPort.onDisconnect.addListener(() => { 
      console.warn("VoiceBox: Background port disconnected.");
      bgPort = null; 
    });
  }

  function sendWorker(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgIdCounter;
      pendingCallbacks[id] = { resolve, reject };
      connectBackground();
      bgPort.postMessage({ id, type, payload });
    });
  }

  function handleWorkerMessage(msg) {
    const { id, type, payload } = msg;
    console.log(`VoiceBox: Received [${type}]`, payload || "");
    switch (type) {
      case "MODEL_LOADING_START": setState(State.LOADING_MODEL); break;
      case "MODEL_PROGRESS":
        modelLoadProgress = Math.round(payload.progress ?? 0);
        updateUI();
        break;
      case "MODEL_LOADED":
        console.log("VoiceBox: Model loaded successfully.");
        setState(State.READY);
        if (pendingCallbacks[id]) pendingCallbacks[id].resolve();
        delete pendingCallbacks[id];
        break;
      case "TRANSCRIBE_START": setState(State.PROCESSING); break;
      case "TRANSCRIBE_DONE":
        console.log("VoiceBox: Transcription complete.");
        if (pendingCallbacks[id]) pendingCallbacks[id].resolve(payload.text);
        delete pendingCallbacks[id];
        break;
      case "ERROR":
        console.error("VoiceBox: Worker error:", payload.message);
        setError(payload.message);
        if (pendingCallbacks[id]) pendingCallbacks[id].reject(new Error(payload.message));
        delete pendingCallbacks[id];
        break;
    }
  }

  // ─── Model ──────────────────────────────────────────────────────────────────

  async function ensureModelLoaded() {
    if ([State.READY, State.RECORDING, State.PROCESSING].includes(state)) return;
    setState(State.LOADING_MODEL);
    try {
      connectBackground();
      await sendWorker("LOAD_MODEL", { modelName: Config.modelName });
    } catch (e) {
      setError("Model load failed: " + e.message);
      throw e;
    }
  }

  // ─── Recording ──────────────────────────────────────────────────────────────

  async function startRecording() {
    await ensureModelLoaded();
    if (state !== State.READY) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.start(100);
      setState(State.RECORDING);
    } catch (e) {
      setError("Mic access denied: " + e.message);
    }
  }

  async function stopRecording() {
    if (state !== State.RECORDING || !mediaRecorder) return;
    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        audioChunks = [];
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        try {
          const float32 = await blobToFloat32(blob);
          const sampleRate = 16000;
          const text = await sendWorker("TRANSCRIBE", { audioData: float32, sampleRate });
          if (text) { insertText(text); } else { setError("No speech detected."); }
          setState(State.READY);
        } catch (e) {
          setError("Transcription failed: " + e.message);
        }
        resolve();
      };
      mediaRecorder.stop();
    });
  }

  let sharedAudioContext = null;

  async function blobToFloat32(blob) {
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
       sharedAudioContext = new window.AudioContext({ sampleRate: 16000 });
    }
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await sharedAudioContext.decodeAudioData(arrayBuffer);
    if (decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0);
    }
    const length = decoded.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += channel[i];
    }
    for (let i = 0; i < length; i++) mono[i] /= decoded.numberOfChannels;
    return mono;
  }

  // ─── Insertion ──────────────────────────────────────────────────────────────

  function insertText(text) {
    // Show in UI history
    if (shadow) {
        const area = shadow.getElementById("transcription-area");
        const txt = shadow.getElementById("transcription-text");
        if (area && txt) {
            const current = txt.innerText.replace(/"/g, "");
            const combined = (current ? current + " " : "") + text;
            txt.innerText = `"${combined}"`;
            area.classList.add("active");
        }
    }

    const el = getActiveEditableElement();
    if (el) {
      insertIntoElement(el, text);
    } else if (Config.clipboardFallback) {
      copyToClipboard(text);
      showToast("Copied to Clip");
    } else {
      showToast("Select a field!");
    }
  }

  function getActiveEditableElement() {
    let el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
      if (!hostEl || !hostEl.contains(el)) return el;
    }
    return lastFocusedElement;
  }

  function insertIntoElement(el, text) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const sep = before && !before.endsWith(" ") ? " " : "";
      const newValue = before + sep + text + " " + after;
      el.value = newValue;
      el.selectionStart = el.selectionEnd = before.length + sep.length + text.length + 1;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else if (el.isContentEditable) {
      el.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text + " "));
        range.collapse(false);
      } else {
        el.textContent += " " + text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
  }

  // ─── Interaction ────────────────────────────────────────────────────────────

  async function toggleRecording(e) {
    if (e && e.button !== 0) return;
    if (!isVisible) { showToolbar(); return; }
    
    console.log(`VoiceBox: Toggle triggered in state [${state}]`);
    
    if (state === State.IDLE || state === State.ERROR) {
      if (state === State.ERROR) lastError = "";
      try {
        await ensureModelLoaded();
      } catch (err) {
        console.error("VoiceBox: Failed to load model on click", err);
        return;
      }
    }

    if (state === State.READY) {
      await startRecording();
    } else if (state === State.RECORDING) {
      await stopRecording();
    }
  }

  function setState(s) { 
    console.log(`VoiceBox: State ${state} -> ${s}`);
    state = s; 
    updateUI(); 
  }
  function setError(msg) { 
    console.error("VoiceBox Error:", msg);
    lastError = msg; 
    setState(State.ERROR); 
  }

  // ─── Shadow DOM UI ──────────────────────────────────────────────────────────

  async function buildUI() {
    hostEl = document.createElement("div");
    hostEl.id = "voicebox-host";
    hostEl.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2147483647;
      pointer-events: auto;
      display: none;
    `;
    shadow = hostEl.attachShadow({ mode: "open" });

    async function injectStyles() {
      try {
        const [appCss, fontsCss] = await Promise.all([
          fetch(chrome.runtime.getURL("output.css")).then(res => res.text()),
          fetch(chrome.runtime.getURL("fonts.css")).then(res => res.text())
        ]);
        
        // Inject into Shadow DOM
        const s1 = document.createElement("style");
        s1.textContent = appCss; shadow.appendChild(s1);
        const s2 = document.createElement("style");
        s2.textContent = fontsCss; shadow.appendChild(s2);

        // EXTRA: Inject font-face into document head to ensure availability in some browsers
        if (!document.getElementById('voicebox-fonts')) {
          const sHead = document.createElement("style");
          sHead.id = 'voicebox-fonts';
          sHead.textContent = fontsCss;
          document.head.appendChild(sHead);
        }
      } catch (err) { console.error("VoiceBox: Style injection failed", err); }
    }
    await injectStyles();

    const customStyle = document.createElement("style");
    customStyle.textContent = `
        :host {
            --primary: #c6c6c8;
            --on-surface: #ffffff;
            --on-surface-variant: #a0a0a0;
            --surface-container-high: #1a1a1a;
            --surface-bright: #2a2a2a;
            --outline-variant: #3a3a3a;
            --error: #ff4444;
            --bg-color: #080808;
            --font-inter: 'Inter', sans-serif;
            --font-manrope: 'Manrope', sans-serif;
        }
        .material-symbols-outlined { 
            font-family: 'Material Symbols Outlined' !important; 
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; 
            display: inline-block; 
            line-height: 1; 
            text-transform: none; 
            letter-spacing: normal; 
            word-wrap: normal; 
            white-space: nowrap; 
            direction: ltr; 
            font-size: 20px; 
            vertical-align: middle; 
            font-style: normal;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
            -moz-osx-font-smoothing: grayscale;
        }
        .glass-panel { 
            background: rgba(26, 26, 26, 0.82); 
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 16px 40px rgba(0,0,0,0.2);
            width: 300px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            font-family: var(--font-inter);
            color: var(--on-surface);
            display: flex;
            flex-direction: column;
        }
        .glass-panel.minimized { width: 64px; height: 64px; border-radius: 32px; display: flex; align-items: center; justify-content: center; padding: 0; overflow: visible !important; }
        header { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; height: 32px; background: var(--surface-container-high); border-top-left-radius: 12px; border-top-right-radius: 12px; cursor: grab; }
        .header-title { display: flex; align-items: center; gap: 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2em; color: var(--on-surface-variant); opacity: 0.6; }
        .header-dots { display: flex; gap: 4px; }
        .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--outline-variant); }
        .dot.active { background: var(--primary); }
        .header-actions { display: flex; gap: 4px; }
        .icon-btn { width: 24px; height: 24px; border-radius: 50%; border: none; background: transparent; color: var(--on-surface-variant); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; padding: 0; }
        .icon-btn:hover { background: var(--surface-bright); color: var(--on-surface); }
        #maximize-btn-min:hover { transform: scale(1.1); background: #3a3a3a !important; }
        .icon-btn:active { transform: scale(0.9); }
        .icon-btn.active { color: var(--primary); background: rgba(198, 198, 200, 0.1); }
        .status-section { padding: 12px 24px 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .status-text { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--on-surface-variant); opacity: 0.5; pointer-events: none; }
        .wave-container { display: flex; gap: 4px; height: 14px; align-items: center; opacity: 0; transition: opacity 0.3s; }
        .wave-container.is-listening { opacity: 1; }
        .wave-bar { width: 2px; height: 6px; background: var(--primary); border-radius: 2px; opacity: 0.6; }
        .is-listening .wave-bar { animation: wave 0.6s infinite ease-in-out; }
        @keyframes wave { 0%, 100% { height: 4px; opacity: 0.3; } 50% { height: 12px; opacity: 1; } }
        .interaction-zone { display: flex; justify-content: space-around; align-items: center; padding: 4px 24px 16px; gap: 12px; }
        .mic-btn-container { position: relative; display: flex; align-items: center; justify-content: center; }
        .mic-btn { width: 64px; height: 64px; border-radius: 32px; border: none; background: var(--surface-container-high); color: var(--primary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 10; padding: 0; box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.05); }
        .mic-btn:hover { background: var(--surface-bright); transform: scale(1.05); }
        .mic-btn.active { background: var(--primary); color: var(--bg-color); box-shadow: 0 0 32px rgba(198, 198, 200, 0.4); transform: scale(0.95); }
        .mic-glow { position: absolute; width: 100%; height: 100%; border-radius: 50%; background: rgba(198, 198, 200, 0.25); filter: blur(12px); opacity: 0; transition: opacity 0.4s; pointer-events: none; }
        .mic-btn.active + .mic-glow { opacity: 1; animation: pulse-glow 2s infinite; }
        @keyframes pulse-glow { 0% { transform: scale(0.85); opacity: 0.3; } 50% { transform: scale(1.4); opacity: 0.5; } 100% { transform: scale(0.85); opacity: 0.3; } }
        .transcription-area { padding: 0 20px 16px; max-height: 120px; overflow-y: auto; display: none; margin-top: -4px; }
        .transcription-area.active { display: block; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 12px; }
        .transcription-text { font-size: 11px; line-height: 1.6; color: var(--on-surface-variant); font-style: italic; text-align: center; margin: 0; flex: 1; }
        .history-controls { display: flex; justify-content: center; margin-top: 8px; }
        .clear-history-link { font-size: 9px; color: var(--on-surface-variant); opacity: 0.4; cursor: pointer; text-decoration: none; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
        .clear-history-link:hover { opacity: 0.8; color: var(--error); }
        footer { background: rgba(20, 20, 20, 0.5); padding: 8px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; border-top: 1px solid rgba(255,255,255,0.03); }
        .footer-status { display: flex; align-items: center; gap: 8px; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--outline-variant); transition: background 0.3s; }
        .status-dot.active { background: #ff4d4d; box-shadow: 0 0 8px rgba(255, 77, 77, 0.6); animation: pulse-error 1.2s infinite; }
        @keyframes pulse-error { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .status-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--on-surface-variant); opacity: 0.7; }
        .timer { font-size: 10px; font-family: 'JetBrains Mono', 'Roboto Mono', monospace; color: var(--on-surface-variant); opacity: 0.6; font-weight: 500; }
        .minimized-content { display: none; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; position: relative; }
        .glass-panel.minimized .expanded-content { display: none; }
        .glass-panel.minimized .minimized-content { display: flex; }
        .glass-panel.minimized header, .glass-panel.minimized footer { display: none; }
        
        #vb-settings-view { padding: 16px 24px; display: none; flex-direction: column; gap: 4px; min-height: 140px; }
        #vb-settings-view.active { display: flex; }
        .settings-row { display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .settings-row:last-child { border-bottom: none; }
        .toggle-switch { position: relative; display: inline-block; width: 34px; height: 18px; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #333; transition: .4s; border-radius: 34px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--primary); }
        input:checked + .slider:before { transform: translateX(16px); }
        .settings-btn { background: #333; color: #ddd; border: none; border-radius: 4px; padding: 4px 10px; font-size: 10px; cursor: pointer; transition: background 0.2s; font-weight: 500; }
        .settings-select { background: #333; color: #ddd; border: none; border-radius: 4px; padding: 4px 6px; font-size: 10px; cursor: pointer; font-weight: 500; outline: none; appearance: none; text-align: right; }
        .settings-select option { background: #1a1a1a; }
        .settings-btn:hover { background: #444; color: white; }
        .hidden { display: none !important; }
        
        #vb-toast.show { opacity: 1 !important; }
        #draggable-toolbar { transition: transform 0.2s ease-out; }
        .animate-spin { animation: vb-spin 1.2s linear infinite; }
        @keyframes vb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-pulse { animation: vb-pulse 1.5s ease-in-out infinite; }
        @keyframes vb-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.95); } }
    `;
    shadow.appendChild(customStyle);

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
        <div id="panel" class="glass-panel">
            <header id="header">
                <div class="header-title">
                    <div class="header-dots">
                        <span id="pin-dot" class="dot"></span>
                        <span class="dot"></span>
                    </div>
                    <span>VoiceBox</span>
                </div>
                <div class="header-actions">
                    <button id="pin-btn" class="icon-btn" title="Pin">
                        <span class="material-symbols-outlined" style="font-size: 14px;">push_pin</span>
                    </button>
                    <button id="minimize-btn" class="icon-btn" title="Minimize">
                        <span id="min-icon" class="material-symbols-outlined" style="font-size: 15px;">expand_content</span>
                    </button>
                    <button id="vb-close" class="icon-btn" title="Close" style="margin-left: 2px;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
                    </button>
                </div>
            </header>

            <div id="expanded-view" class="expanded-content">
                <div id="vb-main-view">
                    <section class="status-section">
                        <div id="status-text" class="status-text">Ready</div>
                        <div id="wave-container" class="wave-container">
                            <div class="wave-bar" style="animation-delay: 0s;"></div>
                            <div class="wave-bar" style="animation-delay: 0.1s;"></div>
                            <div class="wave-bar" style="animation-delay: 0.2s;"></div>
                            <div class="wave-bar" style="animation-delay: 0.3s;"></div>
                            <div class="wave-bar" style="animation-delay: 0.4s;"></div>
                        </div>
                    </section>

                    <nav class="interaction-zone">
                        <button id="settings-toggle" class="icon-btn" style="width: 36px; height: 36px; color: #777;">
                            <span class="material-symbols-outlined" style="font-size: 20px;">tune</span>
                        </button>

                        <div class="mic-btn-container">
                            <button id="mic-btn" class="mic-btn">
                                <span id="mic-sym" class="material-symbols-outlined" style="font-size: 32px;">mic</span>
                            </button>
                            <div class="mic-glow"></div>
                        </div>

                        <button id="history-btn" class="icon-btn" style="width: 36px; height: 36px; color: #777;" title="Toggle History">
                            <span class="material-symbols-outlined" style="font-size: 20px;">history</span>
                        </button>
                    </nav>

                    <div id="transcription-area" class="transcription-area">
                        <p id="transcription-text" class="transcription-text"></p>
                        <div class="history-controls">
                            <a id="clear-history-btn" class="clear-history-link">Clear History</a>
                        </div>
                    </div>
                </div>

                <div id="vb-settings-view">
                    <header style="background: transparent; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: default;">
                        <button id="settings-back" class="icon-btn" style="width: 24px; height: 24px;">
                            <span class="material-symbols-outlined" style="font-size: 18px;">arrow_back</span>
                        </button>
                        <div class="header-title" style="margin-left: 8px; flex: 1; opacity: 0.9;">Settings</div>
                    </header>
                    <div style="padding: 16px;">
                        <div class="settings-row">
                            <span style="opacity: 0.8;">Hotkeys</span>
                            <button id="vb-shortcut-btn" class="settings-btn">Configure</button>
                        </div>
                        <div class="settings-row">
                            <span style="opacity: 0.8;">Model Size</span>
                            <select id="vb-model-select" class="settings-select">
                                <option value="Xenova/whisper-tiny.en" ${Config.modelName === 'Xenova/whisper-tiny.en' ? 'selected' : ''}>Tiny (Fast)</option>
                                <option value="Xenova/whisper-base.en" ${Config.modelName === 'Xenova/whisper-base.en' ? 'selected' : ''}>Base (Stable)</option>
                                <option value="Xenova/whisper-small.en" ${Config.modelName === 'Xenova/whisper-small.en' ? 'selected' : ''}>Small (Accurate)</option>
                            </select>
                        </div>
                        <div class="settings-row">
                            <span style="opacity: 0.8;">Clipboard Sync</span>
                            <label class="toggle-switch">
                                <input type="checkbox" id="vb-clipboard-toggle" ${Config.clipboardFallback ? "checked" : ""}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="settings-row" style="border:none; margin-top: 12px; opacity: 0.4;">
                            <span>Model: Whisper-Base (q8)</span>
                        </div>
                    </div>
                </div>

                <footer>
                    <div class="footer-status">
                        <div id="footer-dot" class="status-dot"></div>
                        <span id="footer-label" class="status-label">Standby</span>
                    </div>
                    <div id="timer" class="timer">00:00</div>
                </footer>
            </div>

            <div class="minimized-content">
                <button id="maximize-btn-min" class="icon-btn" title="Expand" style="position: absolute; top: 0px; right: 0px; background: #2a2a2a; border: 1px solid rgba(255,255,255,0.15); width: 22px; height: 22px; border-radius: 50%; z-index: 99999; box-shadow: 0 2px 6px rgba(0,0,0,0.5); transition: transform 0.2s, background 0.2s;">
                    <span class="material-symbols-outlined" style="font-size: 13px; color: var(--primary);">open_in_full</span>
                </button>
                <div class="mic-btn-container" style="position: relative; z-index: 10;">
                    <button id="mic-btn-min" class="mic-btn" style="width: 54px; height: 54px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
                        <span id="mic-sym-min" class="material-symbols-outlined" style="font-size: 28px;">mic</span>
                    </button>
                    <div class="mic-glow"></div>
                </div>
            </div>
            
            <div id="vb-toast" style="position: absolute; top: 40px; left: 50%; transform: translateX(-50%); background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 6px 16px; font-size: 11px; color: #fff; pointer-events: none; opacity: 0; transition: opacity 0.2s; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.5); width: max-content; max-width: 260px; text-align: center;"></div>
        </div>
    `;
    shadow.appendChild(wrapper);
    toolbar = shadow.getElementById("panel");
    document.documentElement.appendChild(hostEl);

    // Event Mappings
    const toggleRec = (e) => { 
        if (e) { e.preventDefault(); e.stopPropagation(); }
        toggleRecording(e); 
    };
    shadow.getElementById("mic-btn").addEventListener("click", toggleRec);
    shadow.getElementById("mic-btn-min").addEventListener("click", toggleRec);
    shadow.getElementById("vb-close").addEventListener("click", hideToolbar);
    shadow.getElementById("settings-toggle").addEventListener("click", toggleSettings);
    shadow.getElementById("settings-back").addEventListener("click", toggleSettings);
    shadow.getElementById("minimize-btn").addEventListener("click", toggleMinimize);
    shadow.getElementById("maximize-btn-min").addEventListener("click", toggleMinimize);
    shadow.getElementById("pin-btn").addEventListener("click", togglePin);
    
    shadow.getElementById("history-btn").addEventListener("click", () => {
        const area = shadow.getElementById("transcription-area");
        area.classList.toggle("active");
        shadow.getElementById("history-btn").classList.toggle("active", area.classList.contains("active"));
    });

    shadow.getElementById("clear-history-btn").addEventListener("click", (e) => {
        e.preventDefault();
        const txt = shadow.getElementById("transcription-text");
        txt.innerText = "";
        shadow.getElementById("transcription-area").classList.remove("active");
        shadow.getElementById("history-btn").classList.remove("active");
        showToast("History Cleared");
    });

    shadow.getElementById("vb-shortcut-btn").addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_SHORTCUTS" });
    });

    shadow.getElementById("vb-model-select").addEventListener("change", (e) => {
        const newModel = e.target.value;
        Config.modelName = newModel;
        chrome.storage.local.set({ modelName: newModel });
        showToast(`Model set to ${newModel.split('/').pop().replace('.en', '')}`);
        // If we are in READY state, we might want to reload it immediately on next click
        // Or if we already have a transcriber, it will be swapped on next ensureModelLoaded
        if (state === State.READY) {
           setState(State.IDLE); // Force re-load on next record
        }
    });

    shadow.getElementById("vb-clipboard-toggle").addEventListener("change", (e) => {
        Config.clipboardFallback = e.target.checked;
        chrome.storage.local.set({ clipboardFallback: Config.clipboardFallback });
        showToast(Config.clipboardFallback ? "Clipboard Sync ON" : "Clipboard Sync OFF");
    });

    makeDraggable(hostEl, shadow.getElementById("header"));
  }

  function toggleSettings() {
    isSettingsVisible = !isSettingsVisible;
    const main = shadow.getElementById("vb-main-view");
    const settings = shadow.getElementById("vb-settings-view");
    const btn = shadow.getElementById("settings-toggle");
    if (isSettingsVisible) {
      main.classList.add("hidden");
      settings.classList.add("active");
      btn.style.color = "var(--primary)";
    } else {
      main.classList.remove("hidden");
      settings.classList.remove("active");
      btn.style.color = "";
    }
  }

  function toggleMinimize() {
    isMinimized = !isMinimized;
    const panel = shadow.getElementById("panel");
    const icon = shadow.getElementById("min-icon");
    if (isMinimized) {
      panel.classList.add("minimized");
      icon.innerText = "open_in_full";
      hostEl.style.transform = "none";
    } else {
      panel.classList.remove("minimized");
      icon.innerText = "expand_content";
      hostEl.style.transform = "translate(-50%, -50%)";
    }
  }

  function togglePin() {
    isPinned = !isPinned;
    const pinDot = shadow.getElementById("pin-dot");
    const pinBtn = shadow.getElementById("pin-btn");
    if (isPinned) {
      pinDot.classList.add("active");
      pinBtn.style.color = "var(--primary)";
      showToast("Pinned to Layer");
    } else {
      pinDot.classList.remove("active");
      pinBtn.style.color = "";
      showToast("Float Mode");
    }
  }

  async function showToolbar() {
    await loadConfig();
    if (!hostEl) await buildUI();
    isVisible = true;
    hostEl.style.display = "block";
    updateUI();
    if (state === State.IDLE) ensureModelLoaded().catch(() => {});
  }

  function hideToolbar() {
    if (state === State.RECORDING) stopRecording();
    isVisible = false;
    if (hostEl) hostEl.style.display = "none";
    if (bgPort) {
        bgPort.disconnect();
        bgPort = null;
    }
    setState(State.IDLE);
  }

  function updateUI() {
    if (!shadow || !hostEl) return;
    const statusText = shadow.getElementById("status-text");
    const footerLabel = shadow.getElementById("footer-label");
    const footerDot = shadow.getElementById("footer-dot");
    const micBtn = shadow.getElementById("mic-btn");
    const micBtnMin = shadow.getElementById("mic-btn-min");
    const wave = shadow.getElementById("wave-container");
    const timer = shadow.getElementById("timer");
    const micSym = shadow.getElementById("mic-sym");
    const micSymMin = shadow.getElementById("mic-sym-min");

    // Reset components
    micBtn.classList.remove("active");
    micBtnMin.classList.remove("active");
    wave.classList.remove("is-listening");
    footerDot.classList.remove("active");
    micSym.innerText = "mic";
    if (micSymMin) micSymMin.innerText = "mic";

    switch (state) {
      case State.IDLE:
        statusText.innerText = "Initializing Engine";
        footerLabel.innerText = "Standby";
        break;
      case State.LOADING_MODEL:
        statusText.innerText = `Loading... ${modelLoadProgress}%`;
        footerLabel.innerText = "Downloading";
        micSym.innerText = "autorenew";
        micSym.classList.add("animate-spin");
        if (micSymMin) {
          micSymMin.innerText = "autorenew";
          micSymMin.classList.add("animate-spin");
        }
        break;
      case State.READY:
        statusText.innerText = "Model is loaded";
        footerLabel.innerText = "Ready";
        micSym.classList.remove("animate-spin");
        if (micSymMin) micSymMin.classList.remove("animate-spin");
        if (timer) timer.innerText = "00:00";
        break;
      case State.RECORDING:
        statusText.innerText = "Dictating Now";
        footerLabel.innerText = "Listening";
        footerDot.classList.add("active");
        micBtn.classList.add("active");
        micBtnMin.classList.add("active");
        wave.classList.add("is-listening");
        startTimer();
        break;
      case State.PROCESSING:
        statusText.innerText = "Analyzing Clip";
        footerLabel.innerText = "Processing";
        micSym.innerText = "hourglass_bottom";
        micSym.classList.add("animate-pulse");
        if (micSymMin) {
          micSymMin.innerText = "hourglass_bottom";
          micSymMin.classList.add("animate-pulse");
        }
        stopTimer();
        break;
      case State.ERROR:
        statusText.innerText = "System Fault";
        footerLabel.innerText = "Error";
        micSym.innerText = "error";
        if (micSymMin) micSymMin.innerText = "error";
        if (lastError) showToast(lastError);
        stopTimer();
        break;
    }
  }

  // ─── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg) {
    const toast = shadow?.getElementById("vb-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  // ─── Drag ───────────────────────────────────────────────────────────────────

  function makeDraggable(el, handle) {
    let isDragging = false;
    let offsetX, offsetY;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = hostEl.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        hostEl.style.transform = 'none';
        hostEl.style.left = rect.left + 'px';
        hostEl.style.top = rect.top + 'px';
        hostEl.style.margin = '0';
    });

    const mv = (e) => {
        if (!isDragging) return;
        hostEl.style.left = (e.clientX - offsetX) + 'px';
        hostEl.style.top = (e.clientY - offsetY) + 'px';
    };
    const up = () => { isDragging = false; };
    
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isVisible) hideToolbar();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "TOGGLE_VOICEBOX") return;
    if (!isVisible)                        showToolbar();
    else if (state === State.RECORDING)    stopRecording();
    else if (state === State.READY)        startRecording();
    else                                   hideToolbar();
  });

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    recordingStartTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        const timerEl = shadow.getElementById("timer");
        if (timerEl) timerEl.innerText = `${mins}:${secs}`;
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
  }

})();