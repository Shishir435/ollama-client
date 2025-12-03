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
  <img src="https://img.shields.io/badge/Firefox-Supported-lightgrey?logo=firefox-browser&style=for-the-badge" alt="Firefox Supported" />
</div>

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

### 🤖 Model Management
- 🔌 **Local Ollama Integration** – Connect to a local Ollama server (no API keys required)
- 🌐 **LAN/Local Network Support** – Connect to Ollama servers on your local network using IP addresses (e.g., `http://192.168.x.x:11434`)
- 🔄 **Model Switcher** – Switch between models in real time with a beautiful UI
- 🔍 **Model Search & Pull** – Search and pull models directly from Ollama.com in the UI (with progress indicator)
- 🗑️ **Model Deletion** – Clean up unused models with confirmation dialogs
- 🧳 **Load/Unload Models** – Manage Ollama memory footprint efficiently
- 📦 **Model Version Display** – View and compare model versions easily
- 🎛️ **Advanced Parameter Tuning** – Per-model configuration: temperature, top_k, top_p, repeat penalty, stop sequences, system prompts

### 💬 Chat & Conversations
- 💬 **Beautiful Chat UI** – Modern, polished interface built with Shadcn UI
- 🗂️ **Multi-Chat Sessions** – Create, manage, and switch between multiple chat sessions
- 📤 **Export Chat Sessions** – Export single or all chat sessions as **PDF** or **JSON**
- 📥 **Import Chat Sessions** – Import single or multiple chat sessions from JSON files
- 📋 **Copy & Regenerate** – Quickly rerun or copy AI responses
- ⚡ **Streaming Responses** – Real-time streaming with typing indicators

### 🧠 Embeddings & Semantic Search (Beta v0.3.0)
- 🔍 **Semantic Chat Search** – Search chat history by meaning, not just keywords
- 📊 **Vector Database** – IndexedDB-based vector storage with optimized cosine similarity
- 🎯 **Smart Chunking** – 3 strategies: fixed, semantic, hybrid (configurable)
- 🚀 **Optimized Search** – Pre-normalized vectors, caching, early termination
- 🔧 **Configurable** – Chunk size, overlap, similarity threshold, search limits
- 📁 **Context-Aware** – Search across all chats or within current session

### 📎 File Upload & Processing (Beta v0.3.0+)
- 📄 **Text Files** – Support for .txt, .md and text based files
- 📁 **PDF Support** – Extract and process text from PDF documents
- 📘 **DOCX Support** – Extract text from Word documents
- 📊 **CSV Support** – Parse CSV, TSV, PSV with custom delimiters and column extraction (Beta v0.5.0)
- 🌐 **HTML Support** – Convert HTML to Markdown for clean text extraction (Beta v0.5.0)
with 50+ language support (Beta v0.5.0)
- ⚙️ **Auto-Embedding** – Automatic embedding generation for uploaded files
- 📊 **Progress Tracking** – Real-time progress indicators during processing
- 🎛️ **Configurable Limits** – User-defined max file size in settings


### 🌐 Webpage Integration
- 🧠 **Enhanced Content Extraction** – Advanced extraction with multiple scroll strategies (none, instant, gradual, smart)
- 🔄 **Lazy Loading Support** – Automatically waits for dynamic content to load
- 📄 **Site-Specific Overrides** – Configure extraction settings per domain (scroll strategies, delays, timeouts)
- 🎯 **Defuddle Integration** – Smart content extraction with Defuddle fallback
- 📖 **Mozilla Readability** – Fallback extraction using Mozilla Readability
- 🎬 **YouTube Transcripts** – Automated YouTube transcript extraction
- 📊 **Extraction Metrics** – View scroll steps, mutations detected, and content length

### ⚙️ Customization & Settings
- 🎨 **Professional UI** – Modern design system with glassmorphism effects, gradients, and smooth animations
- 🌓 **Dark Mode** – Beautiful dark theme with smooth transitions
- 📝 **Prompt Templates** – Create, manage, and use custom prompt templates (Ctrl+/)
- 🔊 **Advanced Text-to-Speech** – Searchable voice selector with adjustable speech rate & pitch
- 🌍 **Internationalization (i18n)** – Full multi-language support with 9 languages: English, Hindi, Spanish, French, German, Italian, Chinese (Simplified), Japanese, Russian
- 🎚️ **Cross-Browser Compatibility** – Works with Chrome, Brave, Edge, Opera, Firefox
- 🧪 **Voice Testing** – Test voices before using them

### 🔒 Privacy & Performance
- 🛡️ **100% Local and Private** – All storage and inference happen on your device
- 🧯 **Declarative Net Request (DNR)** – Automatic CORS handling
- 💾 **IndexedDB Storage** – Efficient local storage for chat sessions
- ⚡ **Performance Optimized** – Lazy loading, debounced operations, optimized re-renders
- 🔄 **State Management** – Clean Zustand-based state management

---

## 🧩 Tech Stack

### Frontend
- **[TypeScript](https://www.typescriptlang.org/)** – Type‑safe development
- **[React 18](https://reactjs.org/)** – Modern UI framework
- **[Plasmo](https://docs.plasmo.com/)** – Chrome‑extension framework
- **[Shadcn UI](https://ui.shadcn.com/)** – Professional component library (Radix UI primitives)
- **[Radix UI](https://www.radix-ui.com/)** – Accessible UI primitives 
- **[Tailwind CSS](https://tailwindcss.com/)** – Utility‑first styling
- **[Lucide React](https://lucide.dev/)** – Icon library
- **[Zustand](https://github.com/pmndrs/zustand)** – Lightweight state management
- **[Dexie](https://dexie.org/)** – IndexedDB wrapper for chat storage

- **[webextension‑polyfill](https://github.com/mozilla/webextension-polyfill)** – Promise‑based browser extension API wrapper

### Backend & APIs
- **[Ollama](https://ollama.com/)** – Local LLM backend
- **[Chrome Extension APIs](https://developer.chrome.com/docs/extensions/)** – `declarativeNetRequest`, `storage`, `sidePanel`, `tabs`

### Content Processing
- **[Defuddle](https://github.com/kepano/defuddle)** – Advanced content extraction
- **[Mozilla Readability](https://github.com/mozilla/readability)** – Content extraction fallback
- **[highlight.js](https://highlightjs.org/)** – Code syntax highlighting
- **[markdown-it](https://github.com/markdown-it/markdown-it)** – Markdown rendering
- **[pdfjs‑dist](https://github.com/mozilla/pdfjs-dist)** – PDF parsing and rendering
- **[dompurify](https://github.com/cure53/DOMPurify)** – HTML sanitization
- **[html2pdf.js](https://github.com/eKoopmans/html2pdf.js)** – Convert HTML to PDF
- **[mammoth](https://github.com/mwilliamson/mammoth.js)** – DOCX to HTML conversion

### Developer Tools
- **[Biome](https://biomejs.dev/)** – Fast formatter & linter
- **[TypeScript](https://www.typescriptlang.org/)** – Strict type checking
- **[Husky](https://typicode.github.io/husky/)** – Git hooks

---

## 🛠️ Quick Setup

### ✅ 1. Install the Extension

👉 [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)

### ✅ 2. Install Ollama on Your Machine

```bash
brew install ollama  # macOS
# or visit https://ollama.com for Windows/Linux installers

ollama serve         # starts at http://localhost:11434
```

**💡 Quick Setup Script** (Cross-platform):

For easier setup with LAN access and Firefox CORS support:

```bash
# Cross-platform bash script (macOS/Linux/Windows with Git Bash)
./tools/ollama-env.sh firefox   # Firefox with CORS + LAN access
./tools/ollama-env.sh chrome    # Chrome with LAN access
```

📄 **Script file:** [`tools/ollama-env.sh`](https://github.com/Shishir435/ollama-client/blob/main/tools/ollama-env.sh)

This script automatically:

- Configures Ollama for LAN access (`0.0.0.0`)
- Sets up CORS for Firefox extensions (if needed)
- Shows your local IP address for network access
- Detects your OS (macOS, Linux, Windows) automatically
- Stops any running Ollama instances before starting

If you don't have the script file, you can [download it directly](https://raw.githubusercontent.com/Shishir435/ollama-client/main/tools/ollama-env.sh) or see the full setup guide: [Ollama Setup Guide](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide)

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

  - **Base URL**: `http://localhost:11434` (default) or your local network IP (e.g., `http://192.168.1.100:11434`)
  - Default model (e.g. `gemma:2b`)
  - Theme & appearance
  - Model parameters
  - Prompt templates

> 💡 **Tip**: You can use Ollama on a local network server by entering its IP address (e.g., `http://192.168.x.x:11434`) in the Base URL field. Make sure Ollama is configured with `OLLAMA_HOST=0.0.0.0` for LAN access.

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

**Setup Ollama for Firefox:**

Firefox requires manual CORS configuration. Use the helper script:

```bash
# Cross-platform bash script (macOS/Linux/Windows with Git Bash)
./tools/ollama-env.sh firefox
```

This configures `OLLAMA_ORIGINS` for Firefox extension support.

**Build and run:**

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

```
src/
├── background/        # Background service worker & API handlers
├── sidepanel/         # Main chat UI
├── options/           # Settings page
├── features/          # Feature modules
│   ├── chat/          # Chat components, hooks, semantic search
│   ├── model/         # Model management & settings
│   ├── sessions/      # Chat session management
│   ├── prompt/        # Prompt templates
│   └── tabs/          # Browser tab integration
├── lib/               # Shared utilities
│   └── embeddings/    # Vector embeddings & semantic search
├── components/        # Shared UI components (Shadcn)
└── hooks/             # Shared React hooks
```

**Architecture**: Feature-based organization with separation of concerns (components, hooks, stores). Zustand for global state, React hooks for local state.

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

## 🧪 Firefox Support

Ollama Client is a Chrome Manifest V3 extension. To use in Firefox:

1. Go to `about:debugging`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` from the extension folder
4. Manually allow CORS access (see [setup guide](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide))

---

## 🐛 Known Issues

- [ ] "Stop Pull" during model downloads may glitch
- [ ] Large chat histories in IndexedDB can impact performance

---

## What’s Next (Roadmap)

Here’s what’s coming up next in **Ollama Client**—grouped by priority:

### High Priority

- [x] Migrate state management to **Zustand** for cleaner logic and global state control
- [x] Add **Export / Import Chat History** (JSON, txt or PDF format)
- [x] Add **Reset App Data** button ("Reset All") under **Options → Reset** (clears IndexedDB + localStorage)
- [x] **Enhanced Content Extraction** – Phase 1 implementation with lazy loading support, site-specific overrides, and Defuddle integration
- [x] **Advanced Text-to-Speech** – Searchable voice selector with rate/pitch controls and cross-browser compatibility
- [x] **Automated YouTube Transcript Extraction** – Automatic button clicking for transcript access
- [x] **GitHub Content Extraction** – Special handling for repository and profile pages

### Embeddings & Semantic Search

- [x] Implement **Ollama Embedding Models**:
  - [x] Integration with Ollama embedding models (e.g., `nomic-embed-text`, `mxbai-embed-large`)
  - [x] Generate embeddings for chat messages and store in IndexedDB
  - [x] Semantic search over chat history (global and per-chat)
  - [x] Auto-embedding toggle and backfill functionality
- [x] **Vector Search Optimization** (Phase 1 - Completed):
  - [x] Brute-force cosine similarity with optimized computation
  - [x] Pre-normalize embeddings on storage
  - [x] Use Float32Array for better memory locality
  - [x] Implement early termination for low similarity scores
  - [x] Add search result caching (configurable TTL & max size)
  - [x] Non-blocking computation (async chunking with yields)
- [x] **Semantic Chat Search UI** (Beta v0.3.0 - Completed):
  - [x] Search dialog with debounced input
  - [x] Search scope toggle (all chats / current chat)
  - [x] Grouped results by session
  - [x] Similarity scores with % match display
  - [x] Click to navigate and highlight message
  - [x] Real-time loading indicators
- [x] **Advanced Vector Search** (Phase 2 - Completed):
  - [x] Optimized vector indexing for faster searches
  - [x] Service Worker-compatible implementation
  - [x] Hybrid search strategy (indexed + brute-force fallback)
  - [x] Incremental index updates
  - [x] Expected performance: 5-10x faster than Phase 1 for datasets >1000 vectors
  - [x] WASM upgrade path documented in `docs/HNSW_WASM_UPGRADE.md` (optional for >50K vectors)
- [ ] Enable **Local RAG** over chats, PDFs, and uploaded files
- [ ] **Browser Search Feature**:
  - [ ] Contextual search within webpage content
  - [ ] Semantic search over extracted content
  - [ ] Search result highlighting
  - [ ] Search history
- [ ] Optional **Web Search Enrichment**:
  - [ ] Offline-first architecture
  - [ ] Opt-in Brave / DuckDuckGo API (user-provided key)
  - [ ] WASM fallback (e.g., tinysearch) when no key

> **Note**: Hybrid embeddings with client-side transformers (`@xenova/transformers`) have been tested and show degraded model response quality compared to direct text prompts. The focus will be on Ollama-hosted embedding models instead.

### File Upload & Processing

- [x] **Text File Support** (Beta v0.3.0 - Completed):
  - [x] Plain text-based formats: `.txt`, `.md` and more.
  - [x] Direct UTF-8 reading
- [x] **PDF Support** (Beta v0.3.0 - Completed):
  - [x] Full text extraction via **pdf.js**
  - [x] Multi-page document support
- [x] **DOCX Support** (Beta v0.3.0 - Completed):
  - [x] Extract text from Word documents via **mammoth.js**
  - [x] Handle formatting and structure
- [x] **Auto-Embedding** (Beta v0.3.0 - Completed):
  - [x] Automatic chunking with configurable strategies
  - [x] Background embedding generation via port messaging
  - [x] Progress tracking with real-time updates
  - [x] Batch processing for performance
- [x] **File Upload Settings** (Beta v0.3.0 - Completed):
  - [x] Configurable max file size
  - [x] Auto-embed toggle
  - [x] Embedding batch size configuration
- [x] **CSV Support** (Beta v0.5.0 - Completed):
  - [x] CSV parsing with d3-dsv
  - [x] Custom delimiter support (comma, tab, pipe, semicolon)
  - [x] Column extraction
  - [x] TSV and PSV file support
- [x] **HTML Support** (Beta v0.5.0 - Completed):
  - [x] HTML to Markdown conversion via Turndown
  - [x] Structure and link preservation

### UX & Metrics Enhancements

- [ ] Track **Per-Session Token Usage** and display in chat metadata (duration, token count)
- [x] Enable **Semantic Chat Search / Filter** once embeddings are in place
- [x] Add **Export/Import UI Buttons** in chat selector ui

---

## 🔗 Useful Links

- 🌐 **Install Extension:** [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)
- 📘 **Docs & Landing Page:** [ollama-client](https://ollama-client.shishirchaurasiya.in/)
- 🐙 **GitHub Repo:** [Github Repo](https://github.com/Shishir435/ollama-client)
- 📖 **Setup Guide:** [Ollama Setup Guide](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide)
- 🔒 **Privacy Policy** [Privacy Policy](https://ollama-client.shishirchaurasiya.in/privacy-policy)
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
