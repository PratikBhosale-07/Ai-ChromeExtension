(function () {
  "use strict";
  if (window.__aiCopilotInjected) return;
  window.__aiCopilotInjected = true;

  let captureEnabled = true;
  let floatBtn = null;
  let selTimer = null;

  init();

  async function init() {
    try {
      const r = await chrome.runtime.sendMessage({ action: "GET_CAPTURE_STATE" });
      if (r) captureEnabled = r.captureEnabled;
    } catch {}
    injectFloatBtn();
    bindEvents();
    listenForInjection();
  }

  //  FLOAT BUTTON 
  function injectFloatBtn() {
    floatBtn = document.createElement("div");
    floatBtn.id = "__ai-copilot-btn";
    floatBtn.setAttribute("data-copilot-ui", "true");
    floatBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Ask AI</span>';
    floatBtn.style.cssText = "position:fixed;z-index:2147483647;display:none;align-items:center;gap:6px;padding:6px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border-radius:20px;font-size:13px;font-family:-apple-system,sans-serif;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(99,102,241,.4);user-select:none;pointer-events:auto;";
    floatBtn.addEventListener("click", onFloatClick);
    document.body.appendChild(floatBtn);
  }

  function bindEvents() {
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("mousedown", onMouseDown, true);
    chrome.runtime.onMessage.addListener(onMsg);
  }

  function onMouseUp(e) {
    if (e.target.closest("[data-copilot-ui]")) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const txt = window.getSelection()?.toString().trim();
      if (txt && txt.length > 2) positionBtn(e.clientX, e.clientY);
      else hideBtn();
    }, 60);
  }

  function onMouseDown(e) {
    if (!e.target.closest("#__ai-copilot-btn")) hideBtn();
  }

  function positionBtn(x, y) {
    if (!captureEnabled) return;
    const W = window.innerWidth;
    const left = Math.min(x + 10, W - 130);
    const top = Math.max(y - 44, 8);
    floatBtn.style.left = left + "px";
    floatBtn.style.top = top + "px";
    floatBtn.style.display = "flex";
  }
  function hideBtn() { if (floatBtn) floatBtn.style.display = "none"; }

  async function onFloatClick(e) {
    e.stopPropagation();
    hideBtn();
    const txt = window.getSelection()?.toString().trim();
    if (!txt) return;
    await chrome.runtime.sendMessage({ action: "AUTO_CAPTURE", payload: { type: "text", content: txt, source: location.href } });
  }

  function onMsg(msg) {
    if (msg.action === "CAPTURE_STATE_CHANGED") {
      captureEnabled = msg.captureEnabled;
      if (!captureEnabled) hideBtn();
    }
  }

  //  AI SITE TEXT INJECTION 
  // These selectors cover the chat inputs of major AI sites
  const SELECTORS_BY_HOST = {
    "chatgpt.com":       ["#prompt-textarea", "textarea[data-id]", "textarea[tabindex='0']"],
    "chat.openai.com":   ["#prompt-textarea", "textarea"],
    "gemini.google.com": [".ql-editor[contenteditable='true']", "[contenteditable='true']", "textarea"],
    "claude.ai":         [".ProseMirror[contenteditable='true']", "[contenteditable='true'][data-placeholder]", "textarea"],
    "perplexity.ai":     ["textarea[placeholder]", "textarea"],
  };

  function getSelectors() {
    const host = location.hostname.replace("www.", "");
    return SELECTORS_BY_HOST[host] || ["textarea", "[contenteditable='true']"];
  }

  function listenForInjection() {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (msg.action !== "INJECT_TEXT") return;
      const ok = injectText(msg.text);
      respond({ ok });
      return true;
    });
  }

  function injectText(text) {
    const selectors = getSelectors();
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.focus();
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
          || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeInputValueSetter) nativeInputValueSetter.call(el, text);
        else el.value = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el.isContentEditable) {
        el.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
        // Fallback: set innerHTML if execCommand didn't work
        if (!el.textContent.trim()) {
          el.textContent = text;
          el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }
      }
      return true;
    }
    // Fallback: write to clipboard (panel will show a paste prompt)
    return false;
  }
})();