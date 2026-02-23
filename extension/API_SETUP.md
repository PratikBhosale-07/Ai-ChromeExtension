# API Key Setup Guide

This extension requires API keys to function. Follow these steps to set up your keys:

## 1. Get Your API Keys

### OpenRouter (for GPT-4, Claude, etc.)

1. Visit https://openrouter.ai/keys
2. Sign up or log in
3. Create a new API key
4. Copy the key (starts with `sk-or-v1-...`)

### Google Gemini (Free)

1. Visit https://makersuite.google.com/app/apikey
2. Sign in with your Google account
3. Create a new API key
4. Copy the key (starts with `AIza...`)

## 2. Add Keys to Extension

1. Load the extension in Chrome
2. Click the extension icon to open the side panel
3. Click the **Settings** icon (⚙️)
4. Paste your API keys in the respective fields:
   - OpenRouter API Key
   - Google Gemini API Key
5. Keys are saved automatically and stored locally

## 3. Security Notes

⚠️ **IMPORTANT**: Your API keys are stored locally in your browser and are never shared with anyone.

- Never commit API keys to version control
- Never share your API keys publicly
- Regenerate keys immediately if exposed
- Use different keys for development and production

## Troubleshooting

### 401 Error (User not found)

- Your OpenRouter API key is invalid or expired
- Generate a new key at https://openrouter.ai/keys

### 402 Error (Insufficient credits)

- Your OpenRouter account has no credits
- Add credits at https://openrouter.ai/credits
- Or use the free Gemini models instead

### API Key Not Saving

- Make sure you clicked outside the input field after pasting
- Check browser console for errors
- Try clearing extension storage and re-entering keys
