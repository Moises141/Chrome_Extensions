# VoiceBox Chrome Extension ⚡️🎤

**Sleek, Private, and High-Performance Offline Voice Dictation.**

VoiceBox is a state-of-the-art Chrome extension that brings the power of OpenAI's Whisper model directly to your browser. Designed for speed and absolute privacy, VoiceBox runs 100% locally using WebAssembly, ensuring your voice data never leaves your machine.

---

## ✨ Features

- 💎 **Modern Floating UI** — A compact "glass-panel" interface that stays out of your way and can be dragged anywhere on the screen.
- 🫧 **Minimized "Bubble" Mode** — Toggle to a minimal circle when not in use to keep your workspace clean.
- 🔒 **Privacy-First Architecture** — Inference runs in a secure **Offscreen Document**, bypassing strict website security policies (CSP) and keeping your data local.
- 🚀 **Performance Optimized** — 8-bit quantization (`q8`) for lightning-fast inference even on modest hardware.
- 📜 **Transcription History** — A collapsible in-UI history area lets you review and clear recent dictations instantly.
- ⚙️ **Advanced Settings** — Tune your experience with model selection (Tiny/Base/Small), clipboard fallback toggles, and shortcut configuration.
- ⌨️ **Global Hotkey** — `Ctrl+Shift+V` (or `Cmd+Shift+V`) to summon the toolbar instantly.
- ✍️ **Smart Insertion** — Seamlessly types into active inputs, textareas, or contenteditable fields with intelligent focus tracking.
- 🌐 **Fully Offline** — Local model execution, local Tailwind styles, and bundled Base64 fonts. No external CDN calls.

---

## 🛠️ Architecture

VoiceBox is built for the modern web, hardened against strict browser security environments like Brave and complex SPAs.

| File | Role |
| :--- | :--- |
| `manifest.json` | MV3 configuration, declares permissions, commands, and offscreen rights. |
| `background.js` | Service Worker managing the lifecycle of the Offscreen Document and global shortcuts. |
| `content.js` | The UI controller; handles the Shadow DOM, dragging, and focus logic. |
| `offscreen.js` | The heavy lifter; runs `@xenova/transformers` (Whisper) in an isolated context. |
| `output.css` | Compiled Tailwind CSS bundle, injected into the Shadow DOM for perfect style isolation. |
| `fonts.css` | Local Base64-encoded typography (Inter, Manrope, Material Symbols). |
| `transformers.min.js` | Localized Whisper runtime to bypass script-loading restrictions. |

---

## 🚀 Setup & Installation

### 1. Load in Chrome
1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer Mode** (top right).
3. Click **Load unpacked**.
4. Select the `voicebox-extension/` directory.

### 2. First Run
- Tap the extension icon or press `Ctrl+Shift+V`.
- On the first load, the Whisper model (~75MB - 150MB) will be downloaded and cached in your browser's IndexedDB.
- **Push to Talk**: Hold the microphone button to record, speak your mind, and let go to transcribe instantly. Or click once to toggle.

---

## ⚡️ Performance & Privacy

We've implemented deep-level optimizations to ensure VoiceBox is the most reliable dictation tool for Chrome:

- **Quantized Inference**: Locked into `dtype: 'q8'` to minimize RAM footprint and maximize CPU efficiency.
- **Audio Context Pooling**: Prevents heavy Garbage Collection sweeps by reusing resources across recording sessions.
- **Shadow DOM Isolation**: The UI is injected into a Shadow Root, ensuring zero interference with website styles or React/Vue state.
- **CSP Bypassing**: Uses a bundled `fonts.css` with Base64 WOFF2 glyphs to render perfect typography on websites that block external fonts.

---

## 🔒 Permissions

- `activeTab`: To insert text into your current page.
- `offscreen`: To run voice inference models in a background environment.
- `scripting`: To inject the UI onto tabs without requiring a refresh.
- `storage`: To remember your dictation history, model choice, and preferences.
- `clipboardWrite`: To provide a fallback when no text field is focused.

---

## 📄 License
MIT © 2026 VoiceBox Team.
