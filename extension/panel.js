'use strict';

//  API CONFIGURATION
let OPENROUTER_API_KEY = '';

const API_URL = 'https://openrouter.ai/api/v1';

const MODELS = [
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', desc: 'OpenAI / Fast & smart', supportsVision: true },
  { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku', desc: 'Anthropic / Fast', supportsVision: true },
];

//  STATE 
let currentModel   = 'auto';
let conversation   = [];        // {role:'user'|'assistant', content:string}
let systemPrompt   = '';
let captureEnabled = true;
let pendingContext = null;      // captured text not yet in a message
let isStreaming    = false;
let abortController = null;     // for cancelling AI requests
let fileAttachments = [];       // {name, type, extractedText}

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
const btnAttach    = $('btnAttach');
const fileInput    = $('fileInput');
const fileAttachmentsEl = $('fileAttachments');

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
  if (!text && !pendingContext && fileAttachments.length === 0) return;

  let displayText = text;  // What to show in chat
  let messageContent = text || 'Please help me analyze the above content.';  // What to send to AI
  const attachedFiles = [...fileAttachments];  // Copy for display
  let hasImages = false;

  // Check if we have images that need vision API
  const images = fileAttachments.filter(f => f.type === 'Image' && f.base64Data);
  const documents = fileAttachments.filter(f => f.type === 'Document');
  
  // Add document text content
  if (documents.length > 0) {
    let docsContext = '';
    documents.forEach(file => {
      docsContext += `[Document: ${file.name}]\n${file.extractedText}\n\n`;
    });
    messageContent = docsContext + messageContent;
  }
  
  // Build vision API content if images exist
  let userMessageContent;
  if (images.length > 0) {
    hasImages = true;
    // Vision API format: array of content objects
    userMessageContent = [];
    
    // Add text
    userMessageContent.push({
      type: 'text',
      text: messageContent
    });
    
    // Add images
    images.forEach(img => {
      userMessageContent.push({
        type: 'image_url',
        image_url: {
          url: img.base64Data
        }
      });
    });
  } else {
    // Text-only message
    userMessageContent = messageContent;
  }
  
  // Clear file attachments after preparing message
  if (fileAttachments.length > 0) {
    clearFileAttachments();
  }

  // If there's captured context, prepend it
  if (pendingContext) {
    const ctx = pendingContext.type === 'image'
      ? `[Image URL: ${pendingContext.content}]\n\n`
      : `[Context from ${pendingContext.source || 'page'}]:\n"""\n${pendingContext.content}\n"""\n\n`;
    
    // Prepend context to message content
    if (typeof userMessageContent === 'string') {
      userMessageContent = ctx + userMessageContent;
    } else if (Array.isArray(userMessageContent)) {
      // For vision API, prepend to text content
      userMessageContent[0].text = ctx + userMessageContent[0].text;
    }
    displayText = ctx + displayText;
    pendingContext = null;
    if (contextPill) contextPill.classList.add('hidden');
  }
  
  // Check if we need vision model for images
  let modelToUse = currentModel;
  if (hasImages) {
    const currentModelData = MODELS.find(m => m.id === currentModel);
    if (!currentModelData?.supportsVision) {
      // Use GPT-4o for this message only (vision support)
      console.log('[Genie] Using GPT-4o for image analysis (your selected model will remain active)');
      modelToUse = 'openai/gpt-4o';
    }
  }

  inputMsg.value = '';
  resizeInput();
  hideWelcome();

  appendMessage('user', displayText, attachedFiles);
  conversation.push({ role: 'user', content: userMessageContent });

  const thinkingEl = appendThinking();
  isStreaming = true;
  
  // Show stop button, hide send button
  btnSend.style.display = 'none';
  btnStop.style.display = 'flex';
  
  // Create abort controller for this request
  abortController = new AbortController();

  try {
    const reply = await callAI(conversation, abortController.signal, modelToUse);
    if (thinkingEl) thinkingEl.remove();
    appendMessage('assistant', reply, [], modelToUse);
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
async function callAI(messages, signal, modelOverride = null) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key not configured. Please add it in Settings.');
  }

  const body = {
    model: modelOverride || currentModel,
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
function appendMessage(role, content, files = [], modelId = null) {
  if (!messagesEl) return null;
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  
  if (role === 'assistant') {
    // Use Genie logo for AI
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('icons/Genie.png');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '8px';
    avatar.appendChild(img);
    wrap.appendChild(avatar);
  } else if (role === 'user') {
    // User icon
    avatar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    wrap.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  
  // Show model badge for assistant messages
  if (role === 'assistant' && modelId) {
    const modelData = MODELS.find(m => m.id === modelId);
    const modelName = modelData ? modelData.label : modelId.split('/').pop();
    const modelBadge = document.createElement('div');
    modelBadge.className = 'model-badge';
    modelBadge.textContent = modelName;
    modelBadge.title = modelId;
    bubble.appendChild(modelBadge);
  }
  
  // If there are files, show pills instead of/before the text content
  if (files && files.length > 0) {
    const filesContainer = document.createElement('div');
    filesContainer.style.display = 'flex';
    filesContainer.style.flexWrap = 'wrap';
    filesContainer.style.gap = '6px';
    filesContainer.style.marginBottom = content ? '8px' : '0';
    
    files.forEach(file => {
      const filePill = document.createElement('div');
      filePill.style.cssText = 'display:flex;align-items:center;gap:6px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);border-radius:20px;padding:4px 10px;font-size:11px;font-weight:500;';
      
      const icon = file.type === 'Image' 
        ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
            <path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
           </svg>`
        : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
           </svg>`;
      
      filePill.innerHTML = `
        <div style="flex-shrink:0;display:flex;align-items:center;">${icon}</div>
        <span>${file.type}</span>
      `;
      filesContainer.appendChild(filePill);
    });
    
    bubble.appendChild(filesContainer);
  }
  
  if (content) {
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = renderMarkdown(content);
    bubble.appendChild(contentDiv);
  } else if (!files || files.length === 0) {
    bubble.innerHTML = renderMarkdown(content);
  }

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
  
  // Paste event listener for images
  inputMsg.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    // Check for image items in clipboard
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Prevent default paste behavior for images
        
        const blob = item.getAsFile();
        if (blob) {
          // Create a File object from the blob
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const extension = item.type.split('/')[1] || 'png';
          const fileName = `pasted-image-${timestamp}.${extension}`;
          const file = new File([blob], fileName, { type: item.type });
          
          // Process the pasted image
          await processFile(file);
        }
        break; // Only handle first image
      }
    }
  });

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
    clearFileAttachments();
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
  
  // File upload
  if (btnAttach && fileInput) {
    btnAttach.addEventListener('click', () => {
      fileInput.click();
    });
    fileInput.addEventListener('change', handleFileSelection);
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

//  FILE UPLOAD FUNCTIONS 
async function handleFileSelection() {
  const files = fileInput.files;
  if (!files || files.length === 0) return;
  
  for (const file of files) {
    await processFile(file);
  }
  
  // Reset file input
  fileInput.value = '';
}

async function processFile(file) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
    return;
  }
  
  const fileType = getFileType(file);
  let extractedText = '';
  let base64Data = null;
  
  // Show processing indicator
  const processingPill = addProcessingPill(file.name, fileType);
  
  try {
    if (fileType === 'Image') {
      // For images, read as base64 for vision API
      base64Data = await readFileAsBase64(file);
      extractedText = `[Image: ${file.name}]`;
    } else if (fileType === 'Document') {
      // For text-based documents, read the content
      extractedText = await readTextFile(file);
    }
    
    // Add to attachments
    fileAttachments.push({
      name: file.name,
      type: fileType,
      extractedText: extractedText,
      base64Data: base64Data
    });
    
    // Remove processing indicator and render final pill
    if (processingPill) processingPill.remove();
    renderFileAttachments();
    
    console.log(`[Genie] Processed ${fileType}: ${file.name}, extracted ${extractedText.length} characters`);
  } catch (error) {
    console.error('[Genie] Error processing file:', error);
    if (processingPill) processingPill.remove();
    alert(`Failed to process "${file.name}": ${error.message}`);
  }
}

function getFileType(file) {
  const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  const docTypes = ['text/plain', 'text/markdown'];
  
  if (imageTypes.includes(file.type) || file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
    return 'Image';
  } else if (docTypes.includes(file.type) || file.name.match(/\.(txt|md)$/i)) {
    return 'Document';
  }
  return 'File';
}

async function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      resolve(text.trim() || '[Empty file]');
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(e.target.result);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function addProcessingPill(fileName, fileType) {
  if (!fileAttachmentsEl) return null;
  
  const pill = document.createElement('div');
  pill.className = 'file-pill processing';
  pill.innerHTML = `
    <div class="file-pill-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.3"/>
        <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
    <span class="file-pill-name">Processing ${fileType.toLowerCase()}...</span>
  `;
  fileAttachmentsEl.appendChild(pill);
  return pill;
}

function renderFileAttachments() {
  if (!fileAttachmentsEl) return;
  
  fileAttachmentsEl.innerHTML = '';
  
  fileAttachments.forEach((file, index) => {
    const pill = document.createElement('div');
    pill.className = 'file-pill';
    
    const icon = file.type === 'Image' 
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
          <path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
         </svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2"/>
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
         </svg>`;
    
    pill.innerHTML = `
      <div class="file-pill-icon">${icon}</div>
      <span class="file-pill-name">${file.type}</span>
      <button class="file-pill-remove" data-index="${index}" title="Remove">&times;</button>
    `;
    
    pill.querySelector('.file-pill-remove').addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      fileAttachments.splice(idx, 1);
      renderFileAttachments();
    });
    
    fileAttachmentsEl.appendChild(pill);
  });
}

function clearFileAttachments() {
  fileAttachments = [];
  if (fileAttachmentsEl) fileAttachmentsEl.innerHTML = '';
}