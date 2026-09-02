/**
 * Shared installable OLC guidance for local-provider connection errors
 */
import { EXTERNAL_URLS } from "@/lib/constants/urls"

const OLC_SETUP_INSTRUCTIONS = `Install **olc** once, then let it configure native Ollama for browser extensions.

macOS / Linux:

\`\`\`bash
curl -fsSL https://ollamaclient.in/olc.sh | sh
olc
\`\`\`

Windows PowerShell:

\`\`\`powershell
irm https://ollamaclient.in/olc.ps1 | iex
olc
\`\`\`

Useful checks:

\`\`\`bash
olc --check --json  # read-only readiness
olc --lan           # trusted-network access (no native authentication)
olc --debug         # foreground diagnostics
\`\`\`

olc preserves existing Ollama origins/settings where the platform exposes them,
adds Chrome, Firefox, and Safari extension origins, verifies the result, and
refuses to kill an unrelated or unverified process. Ollama itself must already
be installed from [ollama.com](https://ollama.com).`

export const ERROR_MESSAGES: Record<number, string> = {
  403: `### ❌ 403 Forbidden: CORS Error

  Your local provider server is **blocking requests** from this browser extension.

---

### 🧭 When Does This Happen?

This error is **most common on Firefox**, where extensions **cannot use DNR** to override CORS headers like in Chrome-based browsers.

In **Chromium-based browsers** (Chrome, Brave, Edge, etc.), the extension uses DNR (Declarative Net Request) to handle CORS automatically.

---

### 🛠️ Fix it: Configure your local provider to Allow Extension Requests

If you're using Ollama, manually allow requests from browser extensions by setting \`OLLAMA_ORIGINS\`.  
If you're using another provider, consult its CORS/origin configuration docs and update the base URL accordingly.

> ✅ Recommended value:  
> \`OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*\`

---

### ⚡ Quick Setup (Easiest Method)

**Install and run olc** — it configures and verifies native Ollama:

${OLC_SETUP_INSTRUCTIONS}

**Manual fallback** (see platform-specific instructions below):

---

<details>
<summary>macOS (Launch Agent)</summary>

1. Open terminal:

   \`\`\`bash
   nano ~/Library/LaunchAgents/com.ollama.server.plist
   \`\`\`

2. Inside \`<key>EnvironmentVariables</key>\`, add:

   \`\`\`xml
   <key>OLLAMA_ORIGINS</key>
   <string>chrome-extension://*,moz-extension://*</string>
   \`\`\`

3. Save and reload the service:

   \`\`\`bash
   # Restart the LaunchAgent (modern macOS)
   launchctl kickstart -k gui/$(id -u)/com.ollama.server
   
   # Or if not loaded, bootstrap first:
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ollama.server.plist
   launchctl kickstart -k gui/$(id -u)/com.ollama.server
   \`\`\`

</details>

---

<details>
<summary>Linux (systemd)</summary>

1. Edit the Ollama systemd service:

   \`\`\`bash
   sudo systemctl edit --full ollama.service
   \`\`\`

2. Add this to the \`[Service]\` section:

   \`\`\`ini
   Environment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*"
   \`\`\`

3. Reload and restart:

   \`\`\`bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   \`\`\`

</details>

---

<details>
<summary>Windows</summary>

1. Press \`Win + R\`, type \`sysdm.cpl\`, and press Enter.  
2. Go to the **Advanced** tab → click **Environment Variables**.  
3. Add a new **User Variable**:

   - **Name:** \`OLLAMA_ORIGINS\`  
   - **Value:** \`chrome-extension://*,moz-extension://*\`

4. Restart Ollama.

</details>

---

<details>
<summary>Allowing Multiple Origins</summary>

To allow both extensions and web clients (like localhost dev tools):

\`\`\`bash
OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*,http://localhost:3000
\`\`\`

</details>

📖 For step-by-step instructions: [provider-setup](${EXTERNAL_URLS.SETUP_GUIDE})  
🔗 Official docs: [https://ollama.com](https://ollama.com)
`,

  0: `### ⚠️ Unable to Reach Local Provider

This extension couldn't connect to your **local provider server**. It might not be running, or the base URL is incorrect.

If you're using Ollama, follow the steps below. For other providers, verify their server is running and double-check the base URL.

---

### ✅ If You're Using Ollama: Make Sure It Is Installed and Running

If you haven't already:

- **Download Ollama:** [https://ollama.com](https://ollama.com)

---

### ⚡ Ollama Quick Setup: Install olc (Recommended)

${OLC_SETUP_INSTRUCTIONS}

---

### 🔧 Ollama Alternative: Start Manually

**Start the server manually:**

\`\`\`bash
ollama serve
\`\`\`

This launches Ollama at \`http://localhost:11434\`.

---

### 🔎 How to Check If It's Running

1. Open your browser to:  
   [http://localhost:11434](http://localhost:11434)

2. Or run in terminal:

   \`\`\`bash
   curl http://localhost:11434/api/tags
   \`\`\`

You should see a JSON response. If not, Ollama isn't active.

---

### ⚙️ Set the Correct Base URL

If you're using a remote server or non-standard port:

- Click the ⚙️ **Settings** icon in the extension popup
- Enter your correct **Base URL** (e.g. \`http://192.168.*.**:11434\`)
- Save and retry

---

Still not working?

- Check your firewall or VPN
- Try restarting the browser
- Visit: [https://ollama.com](https://ollama.com) for troubleshooting
`
}
