# 🧠 How to Set Up Ollama for the Chrome Extension (Ollama Client)

This guide walks you through setting up the Ollama backend so it works seamlessly with the Ollama Client Chrome Extension. We'll cover:

- Installing Ollama
- Pulling your first model (e.g. `gemma:3b`)
- Fixing CORS errors for Chrome extensions

---

## ✅ 1. Install Ollama

Visit the official website to download Ollama:

👉 **[Download Ollama](https://ollama.com)**

Once installed:

```bash
ollama serve
```

This launches the Ollama API server locally at:

```
http://localhost:11434
```

Keep this running while using the extension.

---

## 🤖 2. Pull a Model (e.g. Gemma 3B)

After installation, pull/run a model of your choice:

```bash
ollama run gemma3:1b
```

Once the model is downloaded, you're ready to chat!

> 💡 You can replace `gemma3:1b` with any other model like `llama3`, `mistral`, etc.

---

## 🚫 3. Fix ❌ 403 Forbidden: CORS Error

By default, Ollama blocks requests from browser extensions for security reasons.

To enable access, you **must explicitly allow your Chrome extension** to connect.

### 🛠️ Solution: Set `OLLAMA_ORIGINS=chrome-extension://*`

Follow the instructions based on your operating system:

---

<details>
<summary>🖥️ macOS (Launch Agent)</summary>

1. Open Terminal:

   ```bash
   nano ~/Library/LaunchAgents/com.ollama.server.plist
   ```

2. Inside `<key>EnvironmentVariables</key>`, add:

   ```xml
   <key>OLLAMA_ORIGINS</key>
   <string>chrome-extension://*</string>
   ```

3. Save and reload the service:

   ```bash
   launchctl unload ~/Library/LaunchAgents/com.ollama.server.plist
   launchctl load -w ~/Library/LaunchAgents/com.ollama.server.plist
   ```

</details>

---

<details>
<summary>🐧 Linux (systemd)</summary>

1. Edit Ollama's systemd service:

   ```bash
   sudo systemctl edit --full ollama.service
   ```

2. Under `[Service]`, add:

   ```ini
   Environment="OLLAMA_ORIGINS=chrome-extension://*"
   ```

3. Reload and restart:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

</details>

---

<details>
<summary>🪟 Windows</summary>

1. Press `Win + R`, type `sysdm.cpl`, and hit Enter.

2. Go to **Advanced** → **Environment Variables**.

3. Add a new **User variable**:

   - Name: `OLLAMA_ORIGINS`
   - Value: `chrome-extension://*`

4. Restart Ollama.

</details>

---

## 💡 Multiple Origins Support

You can allow both your extension and local dev tools (like `localhost:3000`) with:

```bash
OLLAMA_ORIGINS=chrome-extension://*,http://localhost:3000
```

---

## 🔍 4. Verify Ollama is Running

Open your browser:

```
http://localhost:11434
```

Or use curl:

```bash
curl http://localhost:11434/api/tags
```

If you see a JSON response, you're good to go!

---

## ⚙️ 5. Configure the Extension

1. Click the **⚙️ Settings** icon in the extension popup.
2. You can configure:

   - Base URL (default is `http://localhost:11434`)
   - Default model (`gemma:3b`, `llama3`, etc.)
   - Theme and other preferences

---

## 🧯 Troubleshooting

- Make sure Ollama is **running**: `ollama serve`
- Ensure your **model is pulled**: `ollama pull gemma:3b`
- **No firewalls/VPNs** blocking `localhost`
- Confirm `OLLAMA_ORIGINS` is properly configured

---

## 📎 Helpful Links

- [Ollama Documentation](https://ollama.com)
- [GitHub: ollama-client](https://github.com/shishir435/ollama-client)
- [Chrome Extension Web Store](https://chromewebstore.google.com/detail/Ollama%20client/bfaoaaogfcgomkjfbmfepbiijmciinjl)

---
