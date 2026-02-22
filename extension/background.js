/**
 * AI Copilot Panel — Background Service Worker (Manifest V3)
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
    console.warn("[AI Copilot] setPanelBehavior:", e.message);
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
    chrome.contextMenus.create({ id: "send-text", title: "Send to AI Copilot", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "analyze-image", title: "Analyze image with AI", contexts: ["image"] });
    chrome.contextMenus.create({ id: "sep1", type: "separator", contexts: ["selection","image"] });
    chrome.contextMenus.create({ id: "toggle-capture", title: captureEnabled ? " Pause AI Capture" : " Resume AI Capture", contexts: ["all"] });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "send-text" && info.selectionText) {
    await handleCapture({ type: "text", content: info.selectionText.trim(), source: tab?.url ?? "", tabId: tab?.id });
  } else if (info.menuItemId === "analyze-image" && info.srcUrl) {
    await handleCapture({ type: "image", content: info.srcUrl, source: tab?.url ?? "", tabId: tab?.id });
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
    console.warn("[AI Copilot] open panel:", e.message);
  }
}

//  CAPTURE 
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
    switch (message.action) {
      case "PANEL_READY":
        sendResponse({ captureEnabled });
        if (pendingPayload) {
          const p = pendingPayload; pendingPayload = null;
          setTimeout(() => sendToPanel(p), 400);
        }
        break;
      case "AUTO_CAPTURE":
        if (captureEnabled) await handleCapture(message.payload);
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
  })();
  return true;
});