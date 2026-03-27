// background.js — MV3 service worker
// Manages the Offscreen Document and relays messages

// ─── Offscreen Document Management ────────────────────────────────────────────

let offscreenCreating = null;
async function setupOffscreen() {
  try {
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (contexts.length > 0) return;
    if (offscreenCreating) { await offscreenCreating; return; }
    
    console.log("VoiceBox: Creating offscreen document...");
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Whisper voice processing'
    });
    await offscreenCreating;
    console.log("VoiceBox: Offscreen document created.");
    offscreenCreating = null;
  } catch (err) {
    console.error("VoiceBox: Failed to setup offscreen document:", err);
    offscreenCreating = null;
  }
}

// ─── Message Relay ──────────────────────────────────────────────────────────

let activePort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "voicebox") {
    console.log("VoiceBox: Content script connected.");
    activePort = port;
    
    port.onMessage.addListener(async (msg) => {
      console.log(`VoiceBox: Relaying msg [${msg.type}] to offscreen`);
      await setupOffscreen();
      chrome.runtime.sendMessage({ target: "offscreen", ...msg });
    });
    
    port.onDisconnect.addListener(() => {
      console.log("VoiceBox: Content script disconnected.");
      activePort = null;
      // Smartly release the model directly from RAM!
      chrome.offscreen.closeDocument().catch(err => {
        console.warn("VoiceBox: Error closing offscreen document:", err);
      });
    });
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target === "background" && activePort) {
    activePort.postMessage(msg);
  }
  if (msg.type === "OPEN_SHORTCUTS") {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  }
});

// ─── Keyboard Command ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-voicebox") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Ensure content script is present
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_VOICEBOX" });
      } catch (err) {
        console.log("VoiceBox: Port error, re-injecting content script...", err);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
          });
          await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_VOICEBOX" });
        } catch (err2) {
          console.error("VoiceBox: Injection failed:", err2);
        }
      }
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_VOICEBOX" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_VOICEBOX" });
    } catch (err) { }
  }
});
