# 🧠 Ollama Client — Chat with Local LLMs in Your Browser

**Ollama Client** is a powerful yet lightweight Chrome extension that lets you interact with locally hosted LLMs using [Ollama](https://ollama.com). Perfect for developers, researchers, and power users who want fast, private AI responses directly inside their browser.

---

### 🚀 Get Started — Install Now!

<div style="text-align:center; margin: 20px 0;">
  <a href="https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl" target="_blank" 
     style="background-color:#4F46E5; color:white; font-size:18px; font-weight:bold; padding: 15px 40px; border-radius:8px; text-decoration:none; display:inline-block;">
    🚀 Install Ollama Client from Chrome Web Store
  </a>
</div>

---

## 🌐 Explore More

Check out the official landing page with full documentation and guides:
👉 [ollama-client](https://shishir435.github.io/ollama-client/ollama-client)

---

## 🚀 Key Features

- 🔌 **Local Ollama Integration** – Connect to your own Ollama server, no API keys required.
- 💬 **In-Browser Chat UI** – Lightweight, minimal chat interface.
- ⚙️ **Custom Settings Panel** – Configure base URL, default model, themes, excluded URLs, and prompt templates.
- 🔄 **Model Switcher** – Switch between any installed Ollama models on the fly.
- 🧭 **Model Search & Add** – Search, pull, and add new Ollama models and track download progress directly from the options page. _(Known issue: pressing Stop during model pull may cause some glitches.)_
- 🎛️ **Model Parameter Tuning** – Adjust temperature, top_k, top_p, repeat penalty and stop sequence.
- ✂️ **Content Parsing** – Automatically extract and summarize page content with Mozilla Readability.
- 📜 **Transcript Parsing** – Supports transcripts from YouTube, Udemy, Coursera.
- 🔊 **Text-to-Speech** – Click the “Speak” button to have the browser read aloud chat responses or page summaries using the Web Speech API.
- 📋 **Regenerate / Copy Response** – Easily rerun AI responses or copy results to clipboard.
- 🗂️ **Multi-Chat Sessions** – Manage multiple chat sessions locally with save, load, and delete.
- 🛡️ **Privacy-First** – All data processing and storage stays local on your machine.
- 🧯 **Declarative Net Request (DNR)** – Handles CORS automatically, no manual config needed (since v0.1.3).

---

## 🛠️ Quick Installation Guide

### ✅ 1. Install the Chrome Extension

Get it from the Chrome Web Store:
👉 [Ollama Client - Chrome Extension](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)

---

### ✅ 2. Install Ollama on Your System

Visit: [https://ollama.com](https://ollama.com)
Then run:

```bash
ollama serve
```

This starts the local server at `http://localhost:11434`.

---

### ✅ 3. Pull a Model (e.g., Gemma 3B)

```bash
ollama pull gemma3:1b
```

> You can also pull other models like `llama3:8b`, `mistral`, `codellama`, etc.

---

### ⚙️ 4. Configure CORS for Chrome Extension Access (If Needed)

Since v0.1.3, Ollama Client uses Chrome's **Declarative Net Request** API to bypass CORS automatically in most environments.
If you still encounter:

> ❌ 403 Forbidden: CORS Error

Please follow this detailed setup:
📖 [Ollama Setup Guide](https://shishir435.github.io/ollama-client/ollama-setup-guide)

---

### ⚙️ Configuration & Options

After installing:

1. Click the **Ollama Client** icon in your browser.
2. Open the ⚙️ **Settings Page**.
3. Configure:

   - ✅ Base URL (`http://localhost:11434`)
   - 🤖 Default Model (e.g., `gemma:3b`)
   - 🎨 Theme Preferences
   - 🚫 Excluded URLs (for auto-context)
   - 📌 Prompt Templates (prefilled tasks like summarize, translate, explain)
   - 🔧 **Model Parameters**:

     - 🔥 **Temperature** (e.g., `0.87`)
     - 🎯 **Top-K** (e.g., `37`)
     - 📈 **Top-P** (e.g., `0.6`)
     - 🧠 **Repeat Penalty** (e.g., `1.1`)
     - 🧾 **System Prompt** (e.g., `You are a helpful assistant...`)
     - 🛑 **Stop Sequences** (e.g., custom output termination strings)

> These settings are saved per model and can be adjusted anytime via the options menu.

---

## 🤔 Which Ollama Model Should You Use?

| System Specs                         | Recommended Models           | Notes                                                               |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------- |
| 🔹 **8GB RAM** (no GPU)              | `gemma:2b`, `mistral:7b-q4`  | Prefer small quantized models (e.g., `q4_0`) for smooth performance |
| 🔹 **16GB RAM** (no GPU)             | `gemma:2b`, `gemma:3b-q4`    | Avoid large models; quantized recommended                           |
| 🔹 **16GB+ RAM** with GPU (6GB VRAM) | `gemma:3b`, `llama3:8b-q4`   | Still use quantized models for efficiency                           |
| 🔹 **32GB+ RAM** or high-end GPU     | `llama3:8b`, `codellama:13b` | Can run larger models with better speed                             |
| 🔹 **RTX 3090+ / Apple M3 Max**      | `llama3:70b`, `mixtral`      | For high-end machines only due to resource demands                  |

> ✅ **Tip:** Quantized models (e.g., `gemma:3b-q4_0`) are preferred for better compatibility and performance.

📚 **Browse More Models**:
👉 [Ollama Model Library](https://ollama.com/library)

---

## 🧩 Tech Stack

- TypeScript
- React + Vite
- Shadcn Ui
- Chrome Extension APIs (Declarative Net Request)
- Ollama (local LLM backend)

---

## 🐞 Known Issues and Limitations

- 🚫 **Stop Generation Bug:** "Stop" only works after generation starts streaming; sometimes it doesn’t abort early.
- 🤖 **Stop pulling model bug** pressing "Stop" during model pull may cause some glitches.
- 🛑 **CORS Issues:** Mostly resolved via DNR, but manual CORS setup may still be needed in some environments.
- 💾 **Storage Size:** IndexedDB storage is local; large chat histories may affect performance on low-end devices.

---

## 🔮 Upcoming Features

- Enhanced chat history management with search and export options.
- Improved error handling and user notifications.

---

## 🔗 Useful Links

- 🌐 **Install Extension:** [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)
- 🚀 **Landing Page** [ollama client](https://shishir435.github.io/ollama-client/ollama-client)
- 📖 **Setup Guide:** [Ollama Setup Instructions](https://shishir435.github.io/ollama-client/ollama-setup-guide)
- 💻 **GitHub Repo:** [github.com/Shishir435/ollama-client](https://github.com/Shishir435/ollama-client)
- 🐛 **Issue Tracker:** [Report a Bug](https://github.com/Shishir435/ollama-client/issues)
- 🙋‍♂️ **Portfolio:** [shishirchaurasiya.in](https://www.shishirchaurasiya.in)
- 💌 **Feature request** [email](mailto:shishirchaurasiya435@gmail.com)

---
