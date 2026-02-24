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
    // Inject keyframes for border animation
    if (!document.getElementById('__genie-btn-styles')) {
      const style = document.createElement('style');
      style.id = '__genie-btn-styles';
      style.textContent = `
        @keyframes genieBorderGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.7), 0 4px 15px rgba(15, 23, 42, 0.5); }
          50% { box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.4), 0 4px 20px rgba(124, 58, 237, 0.6); }
        }
        #__ai-copilot-btn:hover {
          animation: genieBorderGlow 1.5s ease-in-out infinite;
          transform: translateY(-2px);
          background: #0c1a30 !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    floatBtn = document.createElement("div");
    floatBtn.id = "__ai-copilot-btn";
    floatBtn.setAttribute("data-copilot-ui", "true");
    floatBtn.innerHTML = '<img src="' + chrome.runtime.getURL('icons/Genie.png') + '" style="width:32px;height:32px;object-fit:contain;flex-shrink:0;margin:-4px 0;"><span style="line-height:24px;">Ask Genie</span>';
    floatBtn.style.cssText = "position:fixed;z-index:2147483647;display:none;align-items:center;gap:6px;padding:6px 12px 6px 6px;background:#0f172a;color:#fff;border-radius:24px;font-size:13px;font-family:-apple-system,sans-serif;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(15,23,42,.5);user-select:none;pointer-events:auto;transition:all 0.3s ease;border:1px solid rgba(124,58,237,0.3);";
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
    
    console.log('[Genie] Float button clicked, sending:', txt.substring(0, 50) + '...');
    
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: "AUTO_CAPTURE", 
        payload: { type: "text", content: txt, source: location.href } 
      });
      console.log('[Genie] Message sent, response:', response);
    } catch (err) {
      console.error('[Genie] Error sending message:', err);
      // Extension context invalidated - reload the page to reinject the script
      if (err.message.includes('Extension context invalidated')) {
        alert('Genie extension was reloaded. Please refresh this page to continue using it.');
      } else {
        alert('Genie: ' + err.message);
      }
    }
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