'use strict';

//  API CONFIGURATION
let OPENROUTER_API_KEY = '';

const API_URL = 'https://openrouter.ai/api/v1';

const MODELS = [
  { id: 'openai/gpt-4o', label: 'GPT-4o', desc: 'OpenAI / Most capable' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', desc: 'OpenAI / Fast & smart' },
  { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku', desc: 'Anthropic / Fast' },
  { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B', desc: 'Meta / Powerful open' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', desc: 'Meta / Fast open' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V2.5', desc: 'DeepSeek / Best for coding' },
  { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B', desc: 'Alibaba / Smart' },
  { id: 'mistralai/mistral-large', label: 'Mistral Large', desc: 'Mistral / Powerful' },
];

//  STATE 
let currentModel   = 'auto';
let conversation   = [];        // {role:'user'|'assistant', content:string}
let systemPrompt   = '';
let captureEnabled = true;
let pendingContext = null;      // captured text not yet in a message
let isStreaming    = false;
let abortController = null;     // for cancelling AI requests

//  DOM 
const $ = id => document.getElementById(id);
const messagesEl   = $('messages');
const welcomeEl    = $('welcome');
const inputMsg     = $('inputMsg');
const btnSend      = $('btnSend');
const btnStop      = $('btnStop');
const btnNewChat   = $('btnNewChat');
const btnRefresh   = $('btnRefresh');
const btnCapture   = $('btnCapture');
const icoCapture   = $('icoCapture');
const btnPresent   = $('btnPresent');
const btnSettings  = $('btnSettings');
const btnCloseSettings = $('btnCloseSettings');
const settingsPanel= $('settingsPanel');
const contextPill  = $('contextPill');
const pillLabel    = $('pillLabel');
const btnClearCtx  = $('btnClearCtx');
const presentOverlay = $('presentOverlay');
const btnExitPresent = $('btnExitPresent');
const chkAutoSend  = $('chkAutoSend');
const chkFloat     = $('chkFloat');
const chkDark      = $('chkDark');
const txSystem     = $('txSystem');
const txOpenRouterKey = $('txOpenRouterKey');
const modelBar     = $('modelBar');

//  INIT 
async function init() {
  await loadSettings();
  renderModelBar(); // Render models based on selected provider
  enableModelBarDragScroll(); // Enable mouse drag scrolling
  bindUI();
  bindMessages();
  if (inputMsg) inputMsg.focus();
  try {
    const r = await chrome.runtime.sendMessage({ action: 'PANEL_READY' });
    if (r) { captureEnabled = r.captureEnabled; syncCaptureBtn(); }
  } catch {}
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

//  SETTINGS 
async function loadSettings() {
  const s = await chrome.storage.local.get([
    'model','systemPrompt','darkMode','captureEnabled','autoSend','showFloat','openrouterKey'
  ]);
  
  // Load API key
  if (s.openrouterKey) OPENROUTER_API_KEY = s.openrouterKey;
  
  // Validate model exists
  const savedModel = s.model ?? MODELS[0].id;
  const modelIds = MODELS.map(m => m.id);
  currentModel = modelIds.includes(savedModel) ? savedModel : MODELS[0].id;
  
  // If model was invalid, save the default
  if (savedModel !== currentModel) {
    save('model', currentModel);
  }
  
  systemPrompt   = s.systemPrompt ?? '';
  captureEnabled = s.captureEnabled ?? true;
  const dark     = s.darkMode     ?? true;
  chkAutoSend.checked = s.autoSend  ?? true;
  chkFloat.checked    = s.showFloat ?? true;
  chkDark.checked     = dark;
  txSystem.value      = systemPrompt;
  if (txOpenRouterKey) txOpenRouterKey.value = OPENROUTER_API_KEY;
  document.body.classList.toggle('dark',  dark);
  document.body.classList.toggle('light', !dark);
}

function save(k, v) { chrome.storage.local.set({ [k]: v }); }

// Render model bar
function renderModelBar() {
  if (!modelBar) return;
  
  modelBar.innerHTML = '';
  
  MODELS.forEach(model => {
    const chip = document.createElement('button');
    chip.className = 'model-chip';
    chip.dataset.model = model.id;
    chip.textContent = model.label;
    chip.title = model.desc;
    
    if (model.id === currentModel) {
      chip.classList.add('active');
    }
    
    chip.addEventListener('click', () => {
      currentModel = model.id;
      save('model', currentModel);
      document.querySelectorAll('.model-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    
    modelBar.appendChild(chip);
  });
}

// Enable mouse drag scrolling for model bar
function enableModelBarDragScroll() {
  if (!modelBar) return;
  
  let isDown = false;
  let startX;
  let scrollLeft;
  
  // Mouse drag scrolling
  modelBar.addEventListener('mousedown', (e) => {
    // Only enable drag on the bar itself, not on buttons
    if (e.target.classList.contains('model-chip')) return;
    
    isDown = true;
    modelBar.classList.add('dragging');
    startX = e.pageX - modelBar.offsetLeft;
    scrollLeft = modelBar.scrollLeft;
  });
  
  modelBar.addEventListener('mouseleave', () => {
    isDown = false;
    modelBar.classList.remove('dragging');
  });
  
  modelBar.addEventListener('mouseup', () => {
    isDown = false;
    modelBar.classList.remove('dragging');
  });
  
  modelBar.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - modelBar.offsetLeft;
    const walk = (x - startX) * 2; // Multiply for faster scroll
    modelBar.scrollLeft = scrollLeft - walk;
  });
  
  // Mouse wheel scrolling (convert vertical to horizontal)
  modelBar.addEventListener('wheel', (e) => {
    e.preventDefault();
    modelBar.scrollLeft += e.deltaY;
  });
}

//  CHAT — SEND 
async function sendMessage() {
  if (isStreaming || !inputMsg || !btnSend) return;
  let text = inputMsg.value.trim();
  if (!text && !pendingContext) return;

  // If there's captured context, prepend it
  if (pendingContext) {
    const ctx = pendingContext.type === 'image'
      ? `[Image URL: ${pendingContext.content}]\n\n`
      : `[Context from ${pendingContext.source || 'page'}]:\n"""\n${pendingContext.content}\n"""\n\n`;
    text = ctx + (text || 'Please help me with the above.');
    pendingContext = null;
    if (contextPill) contextPill.classList.add('hidden');
  }

  inputMsg.value = '';
  resizeInput();
  hideWelcome();

  appendMessage('user', text);
  conversation.push({ role: 'user', content: text });

  const thinkingEl = appendThinking();
  isStreaming = true;
  
  // Show stop button, hide send button
  btnSend.style.display = 'none';
  btnStop.style.display = 'flex';
  
  // Create abort controller for this request
  abortController = new AbortController();

  try {
    const reply = await callAI(conversation, abortController.signal);
    if (thinkingEl) thinkingEl.remove();
    appendMessage('assistant', reply);
    conversation.push({ role: 'assistant', content: reply });
  } catch (err) {
    if (thinkingEl) thinkingEl.remove();
    if (err.name === 'AbortError') {
      appendMessage('assistant', '⚠️ Generation stopped.');
    } else {
      // Show more helpful error message
      let errorMsg = `❌ Error: ${err.message}`;
      if (err.message.includes('402') || err.message.includes('credits')) {
        errorMsg += '\n\n💡 Tip: Try using Gemini models (free) or reduce your message length.';
      }
      appendMessage('assistant', errorMsg);
    }
  }

  // Reset UI
  isStreaming = false;
  abortController = null;
  btnStop.style.display = 'none';
  btnSend.style.display = 'flex';
  btnSend.disabled = false;
  inputMsg.focus();
  scrollToBottom();
}

//  STOP GENERATION
function stopGeneration() {
  if (abortController) {
    abortController.abort();
  }
}

//  AI API CALL
async function callAI(messages, signal) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key not configured. Please add it in Settings.');
  }

  const body = {
    model: currentModel,
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages,
    temperature: 0.7,
    max_tokens: 2000,
  };

  const res = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://genie-extension.local',
      'X-Title': 'Genie Extension',
    },
    body: JSON.stringify(body),
    signal: signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let errorMsg = `OpenRouter API ${res.status}: ${errText.slice(0, 200)}`;
    if (res.status === 401) {
      errorMsg = 'Invalid OpenRouter API key. Please update your API key in Settings.';
    } else if (res.status === 402) {
      errorMsg = 'OpenRouter: Insufficient credits. Please add credits to your account.';
    } else if (res.status === 404) {
      errorMsg = `Model "${currentModel}" not found. Try a different model.`;
    } else if (res.status === 429) {
      errorMsg = 'Rate limit reached. Please wait a moment and try again.';
    }
    throw new Error(errorMsg);
  }

  const data = await res.json();
  
  if (data.choices && data.choices[0]?.message?.content) {
    return data.choices[0].message.content.trim();
  }
  
  throw new Error('Unexpected response format from OpenRouter API');
}

//  MESSAGE RENDERING 
function appendMessage(role, content) {
  if (!messagesEl) return null;
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    wrap.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdown(content);

  if (role === 'assistant') {
    // Copy button for assistant
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'act-btn';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/>
      </svg> Copy`;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content).catch(() => {});
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.innerHTML = copyBtn.innerHTML.replace('Copied!', 'Copy'); }, 1500);
    });
    actions.appendChild(copyBtn);
    wrap.appendChild(bubble);
    wrap.appendChild(actions);
  } else if (role === 'user') {
    // Copy and Edit buttons for user
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'act-btn';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/>
      </svg> Copy`;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content).catch(() => {});
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/>
        </svg> Copy`; }, 1500);
    });
    
    const editBtn = document.createElement('button');
    editBtn.className = 'act-btn';
    editBtn.title = 'Edit';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg> Edit`;
    editBtn.addEventListener('click', () => {
      if (inputMsg) {
        inputMsg.value = content;
        inputMsg.focus();
        // Adjust textarea height
        inputMsg.style.height = 'auto';
        inputMsg.style.height = Math.min(inputMsg.scrollHeight, 150) + 'px';
      }
    });
    
    actions.appendChild(copyBtn);
    actions.appendChild(editBtn);
    wrap.appendChild(bubble);
    wrap.appendChild(actions);
  } else {
    wrap.appendChild(bubble);
  }

  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function appendThinking() {
  if (!messagesEl) return null;
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.innerHTML = `<div class="msg-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg></div>
    <div class="bubble thinking"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

//  MINIMAL MARKDOWN RENDERER 
function renderMarkdown(md) {
  let html = esc(md);
  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="code-block"><div class="code-lang">${lang || 'code'}</div><code>${code.trim()}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  // Unordered lists (convert consecutive lines starting with - or *)
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, m => '<ul>' + m + '</ul>');
  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');
  // Paragraphs / line breaks (skip inside pre/ul)
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return '<p>' + html + '</p>';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

//  PASTE TO INPUT HANDLING
function handlePasteToInput(payload) {
  console.log('[AI Copilot Panel] handlePasteToInput called with:', payload);
  
  if (!inputMsg) {
    console.error('[AI Copilot Panel] Input element not found!');
    return;
  }
  
  // Format content based on type
  let contentText = '';
  if (payload.type === 'image') {
    contentText = `[Image: ${payload.content}]`;
  } else {
    contentText = payload.content;
  }
  
  // Paste into input (append if there's existing text)
  const currentValue = inputMsg.value.trim();
  if (currentValue) {
    inputMsg.value = currentValue + '\n\n' + contentText;
  } else {
    inputMsg.value = contentText;
  }
  
  console.log('[AI Copilot Panel] Text pasted to input:', contentText.substring(0, 50) + '...');
  
  // Adjust textarea height and focus
  resizeInput();
  inputMsg.focus();
  
  // Scroll to end of textarea
  inputMsg.selectionStart = inputMsg.value.length;
  inputMsg.selectionEnd = inputMsg.value.length;
}

//  CAPTURE HANDLING 
function handleCapture(payload) {
  pendingContext = payload;

  const preview = payload.type === 'image'
    ? 'Image'
    : payload.content.slice(0, 48) + (payload.content.length > 48 ? '' : '');
  pillLabel.textContent = preview;
  contextPill.classList.remove('hidden');

  if (chkAutoSend.checked) {
    // Auto-pop into input and send
    inputMsg.value = '';
    sendMessage();
  } else {
    inputMsg.focus();
    inputMsg.placeholder = 'Ask something about the captured content';
    setTimeout(() => { inputMsg.placeholder = 'Message Genie  (Ctrl+Enter to send)'; }, 4000);
  }
}

//  RUNTIME MESSAGES 
function bindMessages() {
  chrome.runtime.onMessage.addListener((msg, _, send) => {
    console.log('[AI Copilot Panel] Message received:', msg.action);
    
    if (msg.action === 'PASTE_TO_INPUT') {
      handlePasteToInput(msg.payload);
      send({ ok: true });
    } else if (msg.action === 'CAPTURE_PAYLOAD') {
      handleCapture(msg.payload);
      send({ ok: true });
    } else if (msg.action === 'CAPTURE_STATE_CHANGED') {
      captureEnabled = msg.captureEnabled;
      syncCaptureBtn();
      send({ ok: true });
    }
    return true;
  });
}

//  UI BINDINGS 
function bindUI() {
  // Model chips are now bound in renderModelBar()

  // Send
  btnSend.addEventListener('click', sendMessage);
  btnStop.addEventListener('click', stopGeneration);
  inputMsg.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape' && isStreaming) { e.preventDefault(); stopGeneration(); }
  });
  inputMsg.addEventListener('input', resizeInput);

  // Context pill dismiss
  btnClearCtx.addEventListener('click', () => {
    pendingContext = null;
    contextPill.classList.add('hidden');
  });

  // New chat
  btnNewChat.addEventListener('click', () => {
    conversation = [];
    pendingContext = null;
    contextPill.classList.add('hidden');
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeEl);
    welcomeEl.classList.remove('hidden');
    inputMsg.value = '';
    inputMsg.focus();
  });

  // Refresh
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      location.reload();
    });
  }

  // Starter chips
  document.querySelectorAll('.starter').forEach(s => {
    s.addEventListener('click', () => {
      inputMsg.value = s.dataset.q;
      resizeInput();
      inputMsg.focus();
    });
  });

  // Capture toggle
  btnCapture.addEventListener('click', async () => {
    const r = await chrome.runtime.sendMessage({ action: 'TOGGLE_CAPTURE' }).catch(() => null);
    if (r) { captureEnabled = r.captureEnabled; syncCaptureBtn(); }
  });

  // Presentation mode
  btnPresent.addEventListener('click', () => {
    presentOverlay.classList.remove('hidden');
    document.body.classList.add('present-mode');
  });
  btnExitPresent.addEventListener('click', () => {
    presentOverlay.classList.add('hidden');
    document.body.classList.remove('present-mode');
  });

  // Settings
  btnSettings.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
  btnCloseSettings.addEventListener('click', () => settingsPanel.classList.add('hidden'));

  chkAutoSend.addEventListener('change', () => save('autoSend', chkAutoSend.checked));
  chkFloat.addEventListener('change', () => save('showFloat', chkFloat.checked));
  chkDark.addEventListener('change', () => {
    const d = chkDark.checked;
    document.body.classList.toggle('dark', d);
    document.body.classList.toggle('light', !d);
    save('darkMode', d);
  });
  txSystem.addEventListener('change', () => {
    systemPrompt = txSystem.value.trim();
    save('systemPrompt', systemPrompt);
  });
  
  // API Key
  if (txOpenRouterKey) {
    txOpenRouterKey.addEventListener('change', () => {
      OPENROUTER_API_KEY = txOpenRouterKey.value.trim();
      save('openrouterKey', OPENROUTER_API_KEY);
    });
  }
}

//  HELPERS 
function syncCaptureBtn() {
  if (!btnCapture || !icoCapture) return;
  btnCapture.title = captureEnabled ? 'Pause capture' : 'Resume capture';
  btnCapture.classList.toggle('paused', !captureEnabled);
  icoCapture.innerHTML = !captureEnabled
    ? `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
       <polygon points="10 8 16 12 10 16" fill="currentColor"/>`
    : `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
       <rect x="9" y="8" width="2" height="8" rx="1" fill="currentColor"/>
       <rect x="13" y="8" width="2" height="8" rx="1" fill="currentColor"/>`;
}

function hideWelcome() {
  if (welcomeEl) welcomeEl.classList.add('hidden');
}

function scrollToBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function resizeInput() {
  if (!inputMsg) return;
  inputMsg.style.height = 'auto';
  inputMsg.style.height = Math.min(inputMsg.scrollHeight, 160) + 'px';
}