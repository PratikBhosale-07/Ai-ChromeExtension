# AI Copilot Chrome Extension

A powerful Chrome extension that provides AI assistance with multiple models including GPT-4, Claude, and Gemini.

## ⚠️ IMPORTANT SECURITY NOTICE

**API keys are NOT included in this repository for security reasons.**

You must obtain and configure your own API keys to use this extension.

## 🚀 Features

- ✨ **Auto Mode** - Automatically selects the best AI model based on your query
- 🤖 **Multiple AI Models** - GPT-4, Claude 3.5, Gemini Flash, and more
- 🛑 **Stop Generation** - Cancel responses with ESC key or stop button
- 📋 **Text Capture** - Capture text from any webpage
- 🎨 **Dark/Light Mode** - Beautiful UI with theme support
- ⚡ **Fast Switching** - Quickly switch between different AI models

## 📦 Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `extension` folder

## 🔑 Setup API Keys

**Before using the extension, you MUST configure your API keys:**

1. Click the extension icon to open the side panel
2. Click the **Settings** icon (⚙️)
3. Add your API keys:
   - **OpenRouter**: Get from https://openrouter.ai/keys
   - **Google Gemini**: Get from https://makersuite.google.com/app/apikey

For detailed setup instructions, see [API_SETUP.md](API_SETUP.md)

## 🎯 Usage

1. Click the extension icon or press **Ctrl+Shift+A**
2. Select an AI model (or use Auto mode)
3. Type your question and press Enter
4. Highlight text on any page to capture it automatically

### Keyboard Shortcuts

- **Ctrl+Shift+A** - Toggle AI panel
- **Ctrl+Shift+S** - Capture selected text
- **Esc** - Stop AI response generation

## 🔒 Security & Privacy

- API keys are stored locally in your browser only
- No data is sent to third parties except the AI providers you choose
- Keys are never included in the source code
- All communication is encrypted (HTTPS)

## ⚠️ **CRITICAL: If Your Keys Were Exposed**

If you accidentally exposed your API keys:

1. **Immediately invalidate the old keys:**
   - OpenRouter: https://openrouter.ai/keys
   - Google AI Studio: https://makersuite.google.com/app/apikey

2. **Generate new API keys**

3. **Update your extension with the new keys**

## 🛠️ Development

Built with:
- Chrome Extension Manifest V3
- Vanilla JavaScript
- OpenRouter API
- Google Gemini API

## 📝 License

MIT License - Feel free to use and modify

## 🤝 Contributing

Contributions are welcome! Please ensure:
- No API keys or sensitive data in commits
- Follow existing code style
- Test thoroughly before submitting PRs

---

**Remember: Never commit API keys to version control!**
