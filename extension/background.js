/**
 * Genie — Background Service Worker (Manifest V3)
 */

let captureEnabled = true;
let pendingPayload  = null;

//  INSTALL / STARTUP 
chrome.runtime.onInstalled.addListener(async () => {
  await buildContextMenus();
  await restoreState();
  try {
    // Auto-open panel when toolbar icon clicked (Chrome 116+)
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn("[Genie] setPanelBehavior:", e.message);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await buildContextMenus();
  await restoreState();
});

async function restoreState() {
  const d = await chrome.storage.local.get(["captureEnabled"]);
  if (typeof d.captureEnabled === "boolean") captureEnabled = d.captureEnabled;
}

//  CONTEXT MENUS 
async function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "send-text", title: "Send to Genie", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "analyze-image", title: "Analyze image with AI", contexts: ["image"] });
    chrome.contextMenus.create({ id: "sep1", type: "separator", contexts: ["selection","image"] });
    chrome.contextMenus.create({ id: "toggle-capture", title: captureEnabled ? " Pause AI Capture" : " Resume AI Capture", contexts: ["all"] });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "send-text" && info.selectionText) {
    await pasteToInput({ type: "text", content: info.selectionText.trim(), source: tab?.url ?? "" }, tab);
  } else if (info.menuItemId === "analyze-image" && info.srcUrl) {
    await pasteToInput({ type: "image", content: info.srcUrl, source: tab?.url ?? "" }, tab);
  } else if (info.menuItemId === "toggle-capture") {
    await toggleCapture();
  }
});

//  PANEL OPEN 
async function openPanel(windowId) {
  try {
    await chrome.sidePanel.open({ windowId });
    await chrome.sidePanel.setOptions({ path: "panel.html", enabled: true });
  } catch (e) {
    console.warn("[Genie] open panel:", e.message);
  }
}

//  PASTE TO INPUT
async function pasteToInput(payload, tab) {
  console.log('[Genie Background] pasteToInput called with:', { payload, tabId: tab?.id, windowId: tab?.windowId });
  
  // Open panel first to ensure it's ready
  if (tab?.windowId) {
    console.log('[Genie Background] Opening panel...');
    await openPanel(tab.windowId);
  } else {
    console.error('[Genie Background] No tab windowId, cannot open panel');
    return;
  }
  
  // Wait a bit for panel to be ready
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Send paste message to panel
  console.log('[Genie Background] Sending PASTE_TO_INPUT message...');
  const sent = await sendPasteToPanel(payload);
  console.log('[Genie Background] Message sent:', sent);
  
  if (!sent) {
    // Store as pending if panel not ready
    console.log('[Genie Background] Panel not ready, storing as pending');
    pendingPayload = payload;
  }
}

async function sendPasteToPanel(payload) {
  try { 
    await chrome.runtime.sendMessage({ action: "PASTE_TO_INPUT", payload }); 
    return true; 
  }
  catch (err) { 
    console.error('[Genie Background] Failed to send to panel:', err);
    return false; 
  }
}

//  CAPTURE (for keyboard shortcut)
async function handleCapture(payload) {
  if (!captureEnabled) return;
  pendingPayload = payload;
  const sent = await sendToPanel(payload);
  if (!sent) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.windowId) await openPanel(tab.windowId);
  }
}

async function sendToPanel(payload) {
  try { await chrome.runtime.sendMessage({ action: "CAPTURE_PAYLOAD", payload }); return true; }
  catch { return false; }
}

//  PAUSE / RESUME 
async function toggleCapture() {
  captureEnabled = !captureEnabled;
  await chrome.storage.local.set({ captureEnabled });
  chrome.contextMenus.update("toggle-capture", {
    title: captureEnabled ? " Pause AI Capture" : " Resume AI Capture",
  });
  try { await chrome.runtime.sendMessage({ action: "CAPTURE_STATE_CHANGED", captureEnabled }); } catch {}
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { action: "CAPTURE_STATE_CHANGED", captureEnabled }).catch(() => {});
  }
}

//  KEYBOARD COMMANDS 
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (command === "toggle-panel" && tab?.windowId) {
    await openPanel(tab.windowId);
  }
  if (command === "capture-selection" && tab?.id) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString().trim() ?? "",
    });
    const text = results?.[0]?.result;
    if (text) await handleCapture({ type: "text", content: text, source: tab.url ?? "", tabId: tab.id });
  }
});

//  MESSAGE HUB 
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case "PANEL_READY":
          if (pendingPayload) {
            const p = pendingPayload; pendingPayload = null;
            setTimeout(() => sendPasteToPanel(p), 400);
          }
          sendResponse({ captureEnabled });
          break;
        case "AUTO_CAPTURE":
          console.log('[Genie Background] AUTO_CAPTURE received:', message.payload);
          if (captureEnabled) {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            console.log('[Genie Background] Tab found:', tab?.id, 'windowId:', tab?.windowId);
            await pasteToInput(message.payload, tab);
          } else {
            console.log('[Genie Background] Capture disabled, ignoring');
          }
          sendResponse({ ok: true });
          break;
        case "GET_CAPTURE_STATE":
          sendResponse({ captureEnabled });
          break;
        case "TOGGLE_CAPTURE":
          await toggleCapture();
          sendResponse({ captureEnabled });
          break;
        case "OPEN_PANEL": {
          const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (t?.windowId) await openPanel(t.windowId);
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false });
      }
    } catch (error) {
      console.error('[Genie] Message handler error:', error);
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true;
});