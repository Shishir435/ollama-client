### ❌ 403 Forbidden: CORS Error

Your Ollama server is blocking requests from this Chrome extension.

#### 🛠️ Fix it:

# Ollama Configuration Required

> To avoid CORS issues, configure your Ollama server to allow requests from Chrome extensions.

---

<details>
<summary>🖥️ macOS</summary>

If you’re using a Launch Agent:

1. Open terminal and run:

   ```bash
   nano ~/Library/LaunchAgents/com.ollama.server.plist
   ```

2. Add this inside \`<key>EnvironmentVariables</key>\`:

   ```xml
   <key>OLLAMA_ORIGINS</key>
   <string>chrome-extension://\*</string>
   ```

3. Save the file and reload the Launch Agent:

   ```bash
   launchctl unload ~/Library/LaunchAgents/com.ollama.server.plist
   launchctl load -w ~/Library/LaunchAgents/com.ollama.server.plist
   ```

</details>

---

<details>
<summary>🐧 Linux (systemd)</summary>

1. Edit the Ollama service:

   ```bash
   sudo systemctl edit --full ollama.service
   ```

2. Under \`[Service]\`, add:

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

1. Open Run (\`Win + R\`), type \`sysdm.cpl\`, and press Enter.
2. Go to the **Advanced** tab → click **Environment Variables**.
3. Add a new **User Variable**:

   - **Name:** \`OLLAMA_ORIGINS\`
   - **Value:** \`chrome-extension://\*\`

4. Restart Ollama for the changes to take effect.

</details>

---

<details>
<summary>💡 **Allowing Multiple Origins**</summary>

If you want to allow multiple origins (e.g., localhost + extension), use:

```bash
OLLAMA_ORIGINS=chrome-extension://*,http://localhost:3000
```

</details>

You can save this as, for example, [ollama-setup-guide](https://shishir435.github.io/ollama-client/ollama-setup-guide).

Or see [https://ollama.com](https://ollama.com) for help.

### ⚠️ Unable to Reach Ollama

Make sure Ollama is installed and running.

Install: [https://ollama.com](https://ollama.com)

Run:

```bash
ollama serve
```
