# 🧠 Ollama Client — Chat with Local LLMs in Your Browser

**Ollama Client** is a powerful, privacy-first Chrome extension that lets you chat with locally hosted LLMs using [Ollama](https://ollama.com) — no cloud, no tracking. It’s lightweight, open source, and designed for fast, offline-friendly AI conversations.

---

  <!-- Browser Support Badges -->
<div style="margin-top: 1.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center;">
  <img src="https://img.shields.io/badge/Chrome-Supported-brightgreen?logo=googlechrome&style=for-the-badge" alt="Chrome Supported" />
  <img src="https://img.shields.io/badge/Chromium-Supported-blue?logo=googlechrome&style=for-the-badge" alt="Chromium Supported" />
  <img src="https://img.shields.io/badge/Brave-Supported-orange?logo=brave&style=for-the-badge" alt="Brave Supported" />
  <img src="https://img.shields.io/badge/Edge-Supported-blue?logo=microsoftedge&style=for-the-badge" alt="Edge Supported" />
  <img src="https://img.shields.io/badge/Opera-Supported-red?logo=opera&style=for-the-badge" alt="Opera Supported" />
  <img src="https://img.shields.io/badge/Arc-Supported-9cf?style=for-the-badge" alt="Arc Supported" />
  <img src="https://img.shields.io/badge/Firefox-Experimental-lightgrey?logo=firefox-browser&style=for-the-badge" alt="Firefox Experimental" />
</div>

---

> ✅ Works with any Chromium-based browser: **Chrome**, **Brave**, **Edge**, **Opera**, **Chromium**, and **Arc**.  
> 🦊 **Firefox support** available via [temporary addon installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) (manual permissions setup required).

---

## 🚀 Get Started — Install Now

<div align="center">
  <a href="https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl" target="_blank">
    <img src="https://img.shields.io/chrome-web-store/v/bfaoaaogfcgomkjfbmfepbiijmciinjl?label=Install%20Ollama%20Client&logo=googlechrome&style=for-the-badge&color=4F46E5&labelColor=000" />
  </a>
  
</div>

---

## ❤️ Upvote Us on Product Hunt!

<div align="center">
<a href="https://www.producthunt.com/products/ollama-client?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-ollama&#0045;client" target="_blank">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=975260&theme=light&t=1749488134483" alt="Ollama&#0032;Client - Chat&#0032;with&#0032;local&#0032;LLMs&#0032;—&#0032;right&#0032;inside&#0032;your&#0032;browser | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
</a>
</div>

## 🌐 Explore More

<div align="center">
<a href="https://ollama-client.shishirchaurasiya.in/" target="_blank"> <img src="https://img.shields.io/badge/View%20Docs-Landing%20Page-blue?style=for-the-badge&logo=readthedocs" alt="Landing Page Documentation" /> </a>
</div>

---

## ✨ Features

- 🔌 **Local Ollama Integration** – Connect to a local Ollama server (no API keys)
- 💬 **In-Browser Chat UI** – Lightweight, minimal, fast
- ⚙️ **Custom Settings** – Control model parameters, themes, prompt templates
- 🔄 **Model Switcher** – Switch between models in real time
- 🔍 **Model Search & Pull** – Pull models directly in the UI (with progress indicator)

* 🗑️ **Model Deletion with Confirmation** – Clean up unused models from the UI
* 🧳 **Load/Unload Models** – Manage Ollama memory footprint efficiently
* 📦 **Model Version Display** – View and compare model versions easily

- 🎛️ **Tune Parameters** – Temperature, top_k, top_p, repeat penalty, stop sequences
- 🧠 **Transcript & Page Summarization** – Works with YouTube, Udemy, Coursera & web articles
- 🔊 **TTS** – Built-in Text-to-Speech via Web Speech API
- 🗂️ **Multi-Chat Sessions** – Save/load/delete local chats
- 🧯 **Declarative Net Request (DNR)** – Automatic CORS handling
- 🛡️ **100% Local and Private** – All storage and inference happen on your device
- 📋 **Copy & Regenerate** – Quickly rerun or copy AI responses

---

## 🧩 Tech Stack

- TypeScript
- React + Vite
- Plasmo (for Chrome extension boilerplate)
- Shadcn UI
- Ollama (local LLM backend)
- Chrome Extension APIs (`declarativeNetRequest`, `storage`, `sidePanel`)

---

## 🛠️ Quick Setup

### ✅ 1. Install the Extension

👉 [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)

### ✅ 2. Install Ollama on Your Machine

```bash
brew install ollama  # macOS
ollama serve         # starts at http://localhost:11434
```

More info: [https://ollama.com](https://ollama.com)

### ✅ 3. Pull a Model

```bash
ollama pull gemma3:1b
```

Other options: `mistral`, `llama3:8b`, `codellama`, etc.

### ⚙️ 4. Configure the Extension

- Click the **Ollama Client** icon
- Open ⚙️ **Settings**
- Set your:

  - Local base URL: `http://localhost:11434`
  - Default model (e.g. `gemma:2b`)
  - Theme & appearance
  - Model parameters
  - Prompt templates

> Advanced parameters like system prompts and stop sequences are available per model.

---

## 🛠️ Local Development Setup

Want to contribute or customize? You can run and modify the Ollama Client extension locally using Plasmo.

### ⚙️ Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- [pnpm](https://pnpm.io/) (recommended) or npm
- [Ollama](https://ollama.com) installed locally

---

### 📦 1. Clone the Repo

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
```

---

### 📥 2. Install Dependencies

Using **pnpm** (recommended):

```bash
pnpm install
```

Or with **npm**:

```bash
npm install
```

---

### 🧪 3. Run the Extension (Dev Mode)

Start development mode with hot reload:

```bash
pnpm dev
```

Or with npm:

```bash
npm run dev
```

This launches the Plasmo dev server and gives instructions for loading the unpacked extension in Chrome:

- Open `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked**
- Select the `dist/` folder generated by Plasmo

---

### 🛠 4. Build for Production

```bash
pnpm build
```

---

### ⛓️ 5. Package for Production

```bash
pnpm package
```

---

### 🧪 6. Run, build and package in Firefox (Experimental)

```bash
pnpm dev --target=firefox
```

```bash
pnpm build --target=firefox
```

```bash
pnpm package --target=firefox
```

Or with npm:

```bash
npm run dev -- --target=firefox
```

Load as a [temporary extension](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

---

### 📁 Code Structure

- `src/`: Core logic and components
- `background.ts`: API bridge + streaming
- `sidepanel.tsx`: Main chat UI
- `options.tsx`: Settings page
- `content.ts`: Summarizer / Readability
- `lib/`: Utility functions
- `hooks/`, `features/`, `context/`: Modular structure for maintainability

---

### ✅ Tips

- Change manifest settings in `package.json`
- PRs welcome! Check [issues](https://github.com/Shishir435/ollama-client/issues) for open tasks

## 💡 Recommended Models by Device

| System Specs                 | Suggested Models            |
| ---------------------------- | --------------------------- |
| 💻 8GB RAM (no GPU)          | `gemma:2b`, `mistral:7b-q4` |
| 💻 16GB RAM (no GPU)         | `gemma:3b-q4`, `mistral`    |
| 🎮 16GB+ with GPU (6GB VRAM) | `llama3:8b-q4`, `gemma:3b`  |
| 🔥 RTX 3090+ or Apple M3 Max | `llama3:70b`, `mixtral`     |

📦 Prefer **quantized models** (`q4_0`, `q5_1`, etc.) for better performance.

Explore: [Ollama Model Library](https://ollama.com/library)

---

## 🧪 Firefox Support (Experimental)

Ollama Client is a Chrome Manifest V3 extension. To use in Firefox:

1. Go to `about:debugging`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` from the extension folder
4. Manually allow CORS access (see [setup guide](https://shishir435.github.io/ollama-client/ollama-setup-guide))

---

## 🐛 Known Issues

- ⛔ "Stop Generation" doesn't always abort early
- ⛔ "Stop Pull" during model download may glitch
- 🔒 CORS mostly handled via DNR, but can fail on older Chromium or network policies
- 💾 Large chat histories in IndexedDB may affect performance

---

## 🔮 Roadmap / Upcoming

- Chat search, filter, and export
- Improved error handling and offline UI fallback
- Better feedback for failed pulls or unreachable server

---

## 🔗 Useful Links

- 🌐 **Install Extension:** [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)
- 📘 **Docs & Landing Page:** [ollama-client](https://ollama-client.shishirchaurasiya.in/)
- 🐙 **GitHub Repo:** [github.com/Shishir435/ollama-client](https://github.com/Shishir435/ollama-client)
- 📖 **Setup Guide:** [Ollama Setup Instructions](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide)
- 🐞 **Issue Tracker:** [Report a Bug](https://github.com/Shishir435/ollama-client/issues)
- 🙋‍♂️ **Portfolio:** [shishirchaurasiya.in](https://www.shishirchaurasiya.in)
- 💡 **Feature Requests:** [Email Me](mailto:shishirchaurasiya435@gmail.com)

---

## 📢 Spread the Word!

If you find Ollama Client helpful, please consider:

- ⭐ Starring the repo
- 📝 Leaving a review on the Chrome Web Store
- 💬 Sharing on socials (tag `#OllamaClient`)

> Built with ❤️ by [@Shishir435](https://www.shishirchaurasiya.in)
