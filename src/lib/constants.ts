import { Bug, Github, Globe, Instagram, Linkedin, Twitter } from "lucide-react"

import type { ModelConfig, SocialLink } from "@/types"

export const MESSAGE_KEYS = {
  OLLAMA: {
    GET_MODELS: "get-ollama-models",
    CHAT_WITH_MODEL: "chat-with-model",
    STREAM_RESPONSE: "ollama-stream-response",
    STOP_GENERATION: "stop-generation",
    SHOW_MODEL_DETAILS: "show-model-details",
    PULL_MODEL: "OLLAMA.PULL_MODEL",
    SCRAPE_MODEL: "scrape-ollama-model",
    SCRAPE_MODEL_VARIANTS: "scrape-ollama-model-variant",
    UPDATE_BASE_URL: "ollama-update-base-url"
  },
  BROWSER: {
    OPEN_TAB: "open-tab",
    GET_PAGE_CONTENT: "get-page-content"
  }
}

export const STORAGE_KEYS = {
  OLLAMA: {
    BASE_URL: "ollama-base-url",
    SELECTED_MODEL: "selected-ollama-model",
    PROMPT_TEMPLATES: "ollama-prompt-templates",
    MODEL_CONFIGS: "ollama-model-config"
  },
  THEME: {
    PREFERENCE: "light-dark-theme"
  },
  BROWSER: {
    TABS_ACCESS: "browser-tab-access",
    EXCLUDE_URL_PATTERNS: "exclude-url-pattern"
  },
  TTS: {
    RATE: "tts-rate",
    PITCH: "tts-pitch",
    VOICE_URI: "tts-voice-uri"
  }
}

export type PromptTemplate = {
  id: string
  title: string
  description?: string
  category?: string
  systemPrompt?: string
  userPrompt: string
  tags?: string[]
  createdAt?: Date
  usageCount?: number
}

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "summarize",
    title: "Summarize Content",
    description: "Create concise bullet-point summaries of any content",
    category: "Analysis",
    userPrompt:
      "Summarize the following content in bullet points, highlighting the key information and main takeaways.",
    tags: ["summary", "analysis", "bullets"],
    usageCount: 0
  },
  {
    id: "explain-code",
    title: "Code Explanation",
    description: "Get detailed step-by-step code explanations",
    category: "Development",
    userPrompt:
      "Explain the following code step by step, including what each part does and how it works together.",
    tags: ["code", "explanation", "development"],
    usageCount: 0
  },
  {
    id: "translate",
    title: "Language Translation",
    description: "Translate text between different languages",
    category: "Language",
    userPrompt:
      "Translate the following text into English. If it's already in English, translate it to Spanish.",
    tags: ["translation", "language", "multilingual"],
    usageCount: 0
  },
  {
    id: "critique",
    title: "Content Critique",
    description: "Get constructive feedback and improvement suggestions",
    category: "Review",
    userPrompt:
      "Provide constructive critique for this content, highlighting strengths and areas for improvement with specific suggestions.",
    tags: ["critique", "feedback", "review"],
    usageCount: 0
  },
  {
    id: "brainstorm",
    title: "Idea Brainstorming",
    description: "Generate creative ideas and solutions",
    category: "Creative",
    userPrompt:
      "Help me brainstorm creative ideas for the following topic. Provide at least 10 diverse and innovative suggestions.",
    tags: ["brainstorm", "creative", "ideas"],
    usageCount: 0
  },
  {
    id: "debug-code",
    title: "Debug Code Issues",
    description: "Identify and fix code problems",
    category: "Development",
    userPrompt:
      "Help me debug this code. Identify any issues, explain what's wrong, and provide a corrected version.",
    tags: ["debug", "code", "fix", "development"],
    usageCount: 0
  },
  {
    id: "email-professional",
    title: "Professional Email",
    description: "Draft professional business emails",
    category: "Communication",
    userPrompt:
      "Help me write a professional email for the following situation. Make it clear, concise, and appropriately formal.",
    tags: ["email", "professional", "business"],
    usageCount: 0
  },
  {
    id: "research-outline",
    title: "Research Outline",
    description: "Create structured research outlines",
    category: "Research",
    userPrompt:
      "Create a comprehensive research outline for the following topic, including main sections, key questions, and potential sources.",
    tags: ["research", "outline", "structure"],
    usageCount: 0
  }
]

export const DEFAULT_EXCLUDE_URLS = [
  "^chrome://",
  "^chrome-extension://",
  "^chrome-untrusted://"
]

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  repeat_penalty: 1.1,
  stop: [],
  system: ""
}

export const SETUP_TABS = [
  {
    value: "macos",
    label: "🖥️ macOS",
    markdown: `
If you’re using a **Launch Agent**:

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
    `
  },
  {
    value: "linux",
    label: "🐧 Linux",
    markdown: `
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
    `
  },
  {
    value: "windows",
    label: "🪟 Windows",
    markdown: `
1. Open Run (Win + R), type \`sysdm.cpl\`, and press Enter.
2. Go to the **Advanced** tab → click **Environment Variables**.
3. Add a new **User Variable**:
   - **Name:** \`OLLAMA_ORIGINS\`
   - **Value:** \`chrome-extension://*\`

4. Restart Ollama for the changes to take effect.
    `
  },
  {
    value: "multi-origin",
    label: "💡 Multiple Origins",
    markdown: `
If you want to allow multiple origins (e.g., localhost + extension), set:

\`\`\`bash
OLLAMA_ORIGINS=chrome-extension://*,http://localhost:3000
\`\`\`
    `
  }
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
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/shishir-chaurasiya/",
    icon: Linkedin
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
    label: "Report Bug / Feature",
    href: "https://github.com/Shishir435/ollama-client/issues",
    icon: Bug
  }
]
