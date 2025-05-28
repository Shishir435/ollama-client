---
# 🧠 Ollama Client — Chat with Local LLMs in Your Browser

**Ollama Client** is a powerful yet lightweight Chrome extension that lets you interact with locally hosted LLMs using [Ollama](https://ollama.com). Perfect for developers, researchers, and power users who want fast, private AI responses directly inside their browser.

> ✅ Now available on the Chrome Web Store: [Install Ollama Client](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)

---

## 🚀 Key Features

- 🔌 **Local Ollama Integration** – Connect to your own Ollama server, no API keys required.
- 💬 **In-Browser Chat UI** – Lightweight, minimal chat interface.
- 🔄 **Model Switcher** – Choose from any installed Ollama model on the fly.
- ⚙️ **Custom Settings Panel** – Configure base URL, default model, theme, and excluded URLs.
- ✂️ **Content Parsing** – Automatically reads and summarizes page content using Mozilla Readability.
- 📜 **Transcript Parsing** – Extracts transcripts from supported platforms like YouTube, Udemy, and Coursera.
- 📋 **Regenerate / Copy Response** – Rerun answers and easily copy outputs.

---

## 🧰 How to Set Up Ollama for This Extension

To use this extension, you need to:

1. **Install Ollama on your machine**
2. **Pull a model** (e.g., `gemma:3b` or `llama3:8b`)
3. **Allow Chrome Extensions via CORS**

Follow this step-by-step guide:
📖 [Ollama Setup Guide for Browser Extensions](https://shishir435.github.io/ollama-client/ollama-setup-guide)

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

This starts a local server at `http://localhost:11434`.

---

### ✅ 3. Pull a Model (e.g., Gemma 3B)

```bash
ollama pull gemma3:1b
```

> You can also pull other models like `llama3:8b`, `mistral`, `codellama`, etc.

---

### ⚙️ 4. Configure CORS for Chrome Extension Access

If you see this error:

> ❌ 403 Forbidden: CORS Error
> Your Ollama server is blocking requests from this Chrome extension.

Then follow the full instructions here:
📖 [Ollama Setup Guide](https://shishir435.github.io/ollama-client/ollama-setup-guide)

It includes specific steps for:

- 🖥️ macOS (Launch Agent)
- 🐧 Linux (systemd)
- 🪟 Windows (Environment Variables)

Example config:

```bash
export OLLAMA_ORIGINS=chrome-extension://*
```

---

## ⚙️ Configuration & Options

After installing:

1. Click the **Ollama Client** icon in your browser.
2. Open the ⚙️ **Settings Page**.
3. Configure:

   - ✅ Base URL (`http://localhost:11434`)
   - 🤖 Default Model (e.g., `gemma:3b`)
   - 🎨 Theme Preferences
   - 🚫 Excluded URLs (for auto-context)

---

### 🤔 Which Ollama Model Should You Use?

Not sure what model your machine can handle? Here's a quick guide based on your hardware:

| System Specs                         | Recommended Models           | Notes                                                                |
| ------------------------------------ | ---------------------------- | -------------------------------------------------------------------- |
| 🔹 **8GB RAM** (no GPU)              | `gemma:2b`, `mistral:7b-q4`  | Stick to small **quantized** models (e.g., `q4_0`)                   |
| 🔹 **16GB RAM** (no GPU)             | `gemma:2b`, `gemma:3b-q4`    | Avoid anything above 3B. Use quantized models for better performance |
| 🔹 **16GB+ RAM** with GPU (6GB VRAM) | `gemma:3b`, `llama3:8b-q4`   | Still use quantized models. Avoid full-precision large models        |
| 🔹 **32GB+ RAM** or **high-end GPU** | `llama3:8b`, `codellama:13b` | Can run larger models with better speed and quality                  |
| 🔹 **RTX 3090+ / Apple M3 Max**      | `llama3:70b`, `mixtral`      | These are massive models — only use on very high-end machines        |

> ✅ **Tip:** Always prefer quantized models (e.g., `gemma:3b-q4_0`) for better compatibility on low-memory systems.

📚 **Browse More Models**:
👉 [Ollama Model Library](https://ollama.com/library)

---

## 🧩 Tech Stack

- **TypeScript**
- **React + Vite**
- **TailwindCSS**
- **Lucide Icons**
- **Chrome Extension APIs**
- **Ollama (LLM backend)**

---

## 🔗 Useful Links

- 🌐 **Install Extension**: [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)
- 📖 **Setup Guide**: [Ollama Setup Instructions](https://shishir435.github.io/ollama-client/ollama-setup-guide)
- 💻 **GitHub Repo**: [github.com/Shishir435/ollama-client](https://github.com/Shishir435/ollama-client)
- 🐛 **Issue Tracker**: [Report a Bug](https://github.com/Shishir435/ollama-client/issues)
- 🙋‍♂️ **Portfolio**: [shishirchaurasiya.in](https://www.shishirchaurasiya.in)

---
