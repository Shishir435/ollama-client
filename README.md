Here’s a refined and clean version of your `README.md` with better formatting, corrected markdown syntax, and consistent styling:

---

# 🧠 Ollama Client — Chat with Local LLMs via Browser Extension

A lightweight and user-friendly browser extension that lets you chat with locally hosted Ollama LLMs — right from your browser. Perfect for quick AI interactions without leaving your current workflow!

---

## 🚀 Features

- 🔌 **Connect to Local Ollama** – Easily hook into your local Ollama server.
- 💬 **Chat Interface** – Minimal and responsive UI for seamless chatting.
- 📦 **Model Selector** – Switch between models on the fly.
- ⚙️ **Settings Page** – Configure server URL and choose default model.
- 🐞 **Report Bugs** – One-click shortcut to report issues or request features.

---

## 🛠️ Installation

> 🔜 Coming soon to Chrome Web Store and Firefox Add-ons!

### Manual Installation (Development)

1. Clone the repo:

   ```bash
   git clone https://github.com/Shishir435/ollama-client.git
   cd ollama-client
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build the extension:

   ```bash
   pnpm build
   ```

4. Load the unpacked extension in your browser:

   - Go to `chrome://extensions` (or your browser’s equivalent)
   - Enable **Developer Mode**
   - Click **Load unpacked** and select the `dist/` folder

---

## ⚙️ Configuration

Make sure your [Ollama](https://ollama.com) server is running:

```bash
ollama serve
```

1. Click the extension icon to open the chat window.
2. Go to the **Options** page:

   - Set your local Ollama server URL (default: `http://localhost:11434`)
   - Select your preferred model (`llama2`, `mistral`, `codellama`, etc.)

---

## 🔐 Avoiding CORS Issues

To allow the browser extension to communicate with your local Ollama server, configure the `OLLAMA_ORIGINS` environment variable on your system.

### 🖥️ macOS (Launch Agent)

1. Edit the launch agent:

   ```bash
   nano ~/Library/LaunchAgents/com.ollama.server.plist
   ```

2. Add inside `<key>EnvironmentVariables</key>`:

   ```xml
   <key>OLLAMA_ORIGINS</key>
   <string>chrome-extension://*</string>
   ```

3. Save and reload the launch agent:

   ```bash
   launchctl unload ~/Library/LaunchAgents/com.ollama.server.plist
   launchctl load -w ~/Library/LaunchAgents/com.ollama.server.plist
   ```

---

### 🐧 Linux (systemd)

1. Edit the Ollama service:

   ```bash
   sudo systemctl edit --full ollama.service
   ```

2. Add under `[Service]`:

   ```bash
   Environment="OLLAMA_ORIGINS=chrome-extension://*"
   ```

3. Reload and restart:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

---

### 🪟 Windows

1. Press `Win + R`, type `sysdm.cpl`, and press Enter.
2. Go to the **Advanced** tab → click **Environment Variables**.
3. Add a new **User Variable**:

   - **Name:** `OLLAMA_ORIGINS`
   - **Value:** `chrome-extension://*`

4. Restart Ollama to apply changes.

---

### 💡 Allowing Multiple Origins

To allow both the extension and local web apps:

```bash
OLLAMA_ORIGINS=chrome-extension://*,http://localhost:3000
```

---

## 🧩 Tech Stack

- **TypeScript**
- **React + Vite**
- **TailwindCSS**
- **Lucide Icons**
- **Chrome Extension APIs**
- **Ollama (local LLM server)**

---

## 📎 Useful Links

- 🔗 [GitHub Repo](https://github.com/Shishir435/ollama-client)
- 🌐 [Portfolio](https://www.shishirchaurasiya.in)
- 🐛 [Report a Bug or Request a Feature](https://github.com/Shishir435/ollama-client/issues)

---
