import type { SocialLink } from "@/types"
import { Bug, Github, Globe, Instagram, Linkedin, Twitter } from "lucide-react"

export const MESSAGE_KEYS = {
  OLLAMA: {
    GET_MODELS: "get-ollama-models",
    CHAT_WITH_MODEL: "chat-with-model",
    STREAM_RESPONSE: "ollama-stream-response",
    STOP_GENERATION: "stop-generation"
  },
  BROWSER: {
    OPEN_TAB: "open-tab",
    GET_PAGE_CONTENT: "get-page-content"
  }
}

export const STORAGE_KEYS = {
  OLLAMA: {
    BASE_URL: "ollama-base-url",
    SELECTED_MODEL: "selected-ollama-model"
  },
  THEME: {
    PREFERENCE: "light-dark-theme"
  },
  BROWSER: {
    TABS_ACCESS: "browser-tab-access",
    EXCLUDE_URL_PATTERNS: "exclude-url-pattern"
  }
}

export const DEFAULT_EXCLUDE_URLS = [
  "^chrome://",
  "^chrome-extension://",
  "^chrome-untrusted://"
]

export const ERROR_MESSAGES: Record<number, string> = {
  403: `### ❌ 403 Forbidden: CORS Error

Your Ollama server is blocking requests from this Chrome extension.

#### Fix it:

# Ollama Configuration Required

> To avoid CORS issues, configure your Ollama server to allow requests from Chrome extensions.

---

<details>
<summary>macOS</summary>

If you’re using a Launch Agent:

1. Open terminal and run:

   \`\`\`bash
   nano ~/Library/LaunchAgents/com.ollama.server.plist
   \`\`\`

2. Add this inside \`<key>EnvironmentVariables</key>\`:

   \`\`\`xml
   <key>OLLAMA_ORIGINS</key>
   <string>chrome-extension://*</string>
   \`\`\`

3. Save the file and reload the Launch Agent:

   \`\`\`bash
   launchctl unload ~/Library/LaunchAgents/com.ollama.server.plist
   launchctl load -w ~/Library/LaunchAgents/com.ollama.server.plist
   \`\`\`

</details>

---

<details>
<summary>Linux (systemd)</summary>

1. Edit the Ollama service:

   \`\`\`bash
   sudo systemctl edit --full ollama.service
   \`\`\`

2. Under \`[Service]\`, add:

   \`\`\`ini
   Environment="OLLAMA_ORIGINS=chrome-extension://*"
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

1. Open Run (\`Win + R\`), type \`sysdm.cpl\`, and press Enter.
2. Go to the **Advanced** tab → click **Environment Variables**.
3. Add a new **User Variable**:

   - **Name:** \`OLLAMA_ORIGINS\`
   - **Value:** \`chrome-extension://*\`

4. Restart Ollama for the changes to take effect.

</details>

---

<details>
<summary>Allowing Multiple Origins</summary>

If you want to allow multiple origins (e.g., localhost + extension), use:

\`\`\`bash
OLLAMA_ORIGINS=chrome-extension://*,http://localhost:3000
\`\`\`

</details>

Please refer: [ollama-setup-guide](https://shishir435.github.io/ollama-client/ollama-setup-guide).

Or see [https://ollama.com](https://ollama.com) for help.`,

  0: `### ⚠️ Unable to Reach Ollama

This extension couldn't connect to your **Ollama server**. It might not be running, or it could be misconfigured.

---

### ✅ Make Sure Ollama is Installed and Running

If you haven't already:

- **Download Ollama:** [https://ollama.com](https://ollama.com)
- **Start the server manually:**

\`\`\`bash
ollama serve
\`\`\`

> This command starts Ollama's local server, typically at \`http://localhost:11434\`

---

### :mag: How to Check if It's Running

1. Open your browser and go to:  
   [http://localhost:11434](http://localhost:11434)

   If the page doesn't load, Ollama is not running.

2. Open a terminal and run:

   \`\`\`bash
   curl http://localhost:11434/api/tags
   \`\`\`

   If you get a list of models or an empty JSON response, Ollama is up.

---

### ⚙️ Configure the Base URL (Optional)

If you're using a remote Ollama server or a custom port:

- Click the **Settings** (⚙️) icon in the top-right of the chat panel.
- This opens the **Options** page.
- There, you can configure:
  - Custom **Base URL** (e.g., \`http://localhost:11434\`)
  - Default **model**
  - Theme preferences and more.

---

Still having trouble?  
Make sure no VPN, firewall, or network policy is blocking requests to \`localhost:11434\`.

For help, visit: [https://ollama.com](https://ollama.com)
`
}

export const SOCIAL_LINKS: SocialLink[] = [
  {
    label: "GitHub Page",
    href: "https://github.com/Shishir435/ollama-client",
    icon: Github
  },
  {
    label: "Portfolio",
    href: "https://www.shishirchaurasiya.in/",
    icon: Globe
  },
  {
    label: "Twitter",
    href: "https://twitter.com/_shishir435",
    icon: Twitter
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/_shishir435/",
    icon: Instagram
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/shishir-chaurasiya/",
    icon: Linkedin
  },
  {
    label: "Report Bug / Feature",
    href: "https://github.com/Shishir435/ollama-client/issues",
    icon: Bug
  }
]
