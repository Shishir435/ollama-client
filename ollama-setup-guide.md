# 🧠 How to Set Up Ollama for the Chrome Extension (Ollama Client)

This guide walks you through setting up the Ollama backend so it works seamlessly with the **Ollama Client Chrome Extension**. We’ll cover:

- Installing Ollama
- Pulling your first model (e.g. `gemma:3b`)
- Fixing CORS errors for different browsers

---

## ✅ 1. Install Ollama

Visit the official website to download Ollama:

👉 **[Download Ollama](https://ollama.com)**

Once installed, start the Ollama server:

```bash
ollama serve
```

This launches the Ollama API at:

```
http://localhost:11434
```

Keep this running while using the extension.

---

## 🤖 2. Pull a Model (e.g. Gemma 3B)

After installation, run a model of your choice:

```bash
ollama run gemma3:1b
```

Once downloaded, you’re ready to chat!

> 💡 Replace `gemma3:1b` with other models like `llama3`, `mistral`, etc.

---

## 🔐 Do You Need to Set Up CORS?

<details>
<summary>Yes, if you're using <strong>Firefox</strong>. Probably <strong>not</strong> for Chrome or other Chromium browsers (click to expand)</summary>

Whether you need to configure CORS depends on your browser:

### ✅ Chrome / Chromium (e.g., Brave, Edge)

If you're using **Chrome-based browsers** and extension version **0.1.3 or later**, you likely **do not need to set any CORS headers**.

Ollama Client uses **Chrome’s Declarative Net Request (DNR)** API to rewrite `Origin` headers in requests to `localhost`, which lets it **bypass CORS errors without backend changes**.

---

### 🦊 Firefox

Firefox does **not support Chrome’s DNR API**, so **manual configuration is required**.

If you're using Firefox, set this in your environment:

```bash
OLLAMA_ORIGINS=moz-extension://*
```

---

### When should you manually set `OLLAMA_ORIGINS`?

- You're using **Firefox**
- You're on **extension version < 0.1.3**
- You're calling from **localhost:3000** or another frontend
- You're still getting ❌ `403 Forbidden` errors

To cover both Chrome and Firefox, you can combine origins:

```bash
OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*
```

</details>

---

## 🚫 3. Fix ❌ 403 Forbidden: CORS Error

If you're seeing CORS errors or using Firefox, follow these platform-specific instructions to set `OLLAMA_ORIGINS`:

---

🖥️ **macOS (Launch Agent)**

1. Edit the plist file:

   ```bash
   nano ~/Library/LaunchAgents/com.ollama.server.plist
   ```

2. Add inside `<key>EnvironmentVariables</key>`:

   ```xml
   <key>OLLAMA_ORIGINS</key>
   <string>chrome-extension://*,moz-extension://*</string>
   ```

3. Reload the agent:

   ```bash
   launchctl unload ~/Library/LaunchAgents/com.ollama.server.plist
   launchctl load -w ~/Library/LaunchAgents/com.ollama.server.plist
   ```

---

🐧 **Linux (systemd)**

1. Edit the service file:

   ```bash
   sudo systemctl edit --full ollama.service
   ```

2. Add under `[Service]`:

   ```ini
   Environment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*"
   ```

3. Reload and restart:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

---

🪟 **Windows**

1. Press `Win + R`, type `sysdm.cpl`, press Enter.

2. Go to **Advanced** → **Environment Variables**.

3. Add a new **User variable**:

   - Name: `OLLAMA_ORIGINS`
   - Value: `chrome-extension://*,moz-extension://*`

4. Restart Ollama.

---

## 💡 Multiple Origins Support

You can also allow local web apps like this:

```bash
OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*,http://localhost:3000
```

---

## 🔍 4. Verify Ollama is Running

Open this in your browser:

```
http://localhost:11434
```

Or use curl:

```bash
curl http://localhost:11434/api/tags
```

You should see a JSON response with available models.

---

## ⚙️ 5. Configure the Extension

1. Click the **⚙️ Settings** icon in the extension popup.
2. You can configure:

   - Base URL (`http://localhost:11434`)
   - Default model (`gemma:3b`, `llama3`, etc.)
   - Theme and other preferences

---

## 🧯 Troubleshooting

- Ensure `ollama serve` is running
- Make sure your model is pulled: `ollama pull <model>`
- Avoid firewalls/VPNs that block `localhost`
- Verify your `OLLAMA_ORIGINS` is correctly set

---

## 📎 Helpful Links

- 🌐 [Ollama Documentation](https://ollama.com)
- 🧩 [Chrome Extension](https://chromewebstore.google.com/detail/Ollama%20client/bfaoaaogfcgomkjfbmfepbiijmciinjl)
- 💻 [GitHub: ollama-client](https://github.com/shishir435/ollama-client)
