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
  "^brave://",
  "^edge://",
  "^vivaldi://",
  "^opera://"
]

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  repeat_penalty: 1.1,
  stop: [],
  system: "",
  num_ctx: 2048,
  repeat_last_n: 64,
  seed: 0,
  num_predict: -1,
  min_p: 0.0
}

export const GUIDES = [
  {
    label: "📖 Ollama Client Setup Guide",
    href: "https://shishir435.github.io/ollama-client/ollama-setup-guide"
  },
  {
    label: "📚 Official Ollama Model Library",
    href: "https://ollama.com/library"
  },
  {
    label: "🔗 Github Repo",
    href: "https://github.com/Shishir435/ollama-client"
  },
  {
    label: "🛠️ Troubleshooting & FAQ",
    href: "https://github.com/Shishir435/ollama-client/issues"
  }
]

export const ERROR_MESSAGES: Record<number, string> = {
  403: `### ❌ 403 Forbidden: CORS Error

  Your Ollama server is **blocking requests** from this browser extension.

---

### 🧭 When Does This Happen?

This error is **most common on Firefox**, where extensions **cannot use DNR** to override CORS headers like in Chrome-based browsers.

In **Chromium-based browsers** (Chrome, Brave, Edge, etc.), the extension uses DNR (Declarative Net Request) to handle CORS automatically.

---

### 🛠️ Fix it: Configure Ollama to Allow Extension Requests

You must manually allow requests from browser extensions by setting \`OLLAMA_ORIGINS\`.

> ✅ Recommended value:  
> \`OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*\`

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
   launchctl unload ~/Library/LaunchAgents/com.ollama.server.plist
   launchctl load -w ~/Library/LaunchAgents/com.ollama.server.plist
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

📖 For step-by-step instructions: [ollama-setup-guide](https://shishir435.github.io/ollama-client/ollama-setup-guide)  
🔗 Official docs: [https://ollama.com](https://ollama.com)
`,

  0: `### ⚠️ Unable to Reach Ollama

This extension couldn't connect to your **Ollama server**. It might not be running, or the base URL is incorrect.

---

### ✅ Make Sure Ollama is Installed and Running

If you haven't already:

- **Download Ollama:** [https://ollama.com](https://ollama.com)
- **Start the server manually:**

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

If you’re using a remote server or non-standard port:

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
