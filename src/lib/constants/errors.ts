// Shared script content from tools/ollama-env.sh
// This ensures both error messages have the same script content
const OLLAMA_ENV_SCRIPT_CONTENT = `#!/bin/bash

# Cross-platform Ollama environment setup script
# Starts Ollama with proper CORS configuration for browser extensions
# Works on macOS, Linux, and Windows (with Git Bash/WSL)
#
# ⚡ QUICK START (Easiest Method):
#   This script automatically configures Ollama for browser extensions.
#   It's the simplest way to get started with CORS setup!
#
# Usage:
#   ./tools/ollama-env.sh [firefox|chrome]
#
# Cross-platform Examples:
#   # macOS/Linux/Windows (Git Bash/WSL):
#   ./tools/ollama-env.sh firefox   # Firefox with CORS + LAN access
#   ./tools/ollama-env.sh chrome    # Chrome with LAN access
#
#   # Windows (PowerShell/CMD):
#   bash tools/ollama-env.sh firefox
#   bash tools/ollama-env.sh chrome
#
#   # Windows (WSL):
#   ./tools/ollama-env.sh firefox
#   ./tools/ollama-env.sh chrome
#
# What this script does:
#   ✅ Automatically detects your OS (macOS, Linux, Windows)
#   ✅ Stops any running Ollama instances
#   ✅ Sets OLLAMA_HOST=0.0.0.0 for LAN access
#   ✅ Sets OLLAMA_ORIGINS for Firefox (if firefox mode)
#   ✅ Starts Ollama in the background
#   ✅ Shows your local IP address for network access
#
# Requirements:
#   - Ollama must be installed: https://ollama.com
#   - Bash shell (pre-installed on macOS/Linux, Git Bash on Windows)
#   - For Windows: Use Git Bash, WSL, or PowerShell with bash

MODE=$1

# Detect OS
OS="$(uname -s)"
case "\${OS}" in
  Linux*)     OS_TYPE="linux" ;;
  Darwin*)    OS_TYPE="macos" ;;
  MINGW*|MSYS*|CYGWIN*) OS_TYPE="windows" ;;
  *)          OS_TYPE="unknown" ;;
esac

# Kill existing Ollama processes
if [ "$OS_TYPE" = "windows" ]; then
  # Windows: Use taskkill if available (Git Bash)
  taskkill //F //IM ollama.exe 2>/dev/null || true
else
  # Unix/Linux/Mac: Use pkill
  pkill -f "ollama serve" 2>/dev/null || true
fi

sleep 1

# Set host to 0.0.0.0 so LAN devices can access it
export OLLAMA_HOST="0.0.0.0"

# Get local IP address (cross-platform)
get_local_ip() {
  if [ "$OS_TYPE" = "macos" ]; then
    # macOS: Use ipconfig getifaddr
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo ""
  elif [ "$OS_TYPE" = "linux" ]; then
    # Linux: Use hostname or ip command
    hostname -I 2>/dev/null | awk '{print $1}' || \\
    ip -4 addr show | grep -oP '(?<=inet\\s)\\d+(\\.\\d+){3}' | head -1 2>/dev/null || echo ""
  elif [ "$OS_TYPE" = "windows" ]; then
    # Windows (Git Bash): Use ipconfig
    ipconfig 2>/dev/null | grep -i "IPv4" | head -1 | grep -oE '[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}' | head -1 || echo ""
  else
    echo ""
  fi
}

# Start Ollama based on mode
if [ "$MODE" = "firefox" ]; then
  export OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"
  nohup ollama serve > ~/.ollama-firefox.log 2>&1 &
  echo "✅ Ollama started with Firefox CORS + LAN access"
else
  nohup ollama serve > ~/.ollama-chrome.log 2>&1 &
  echo "✅ Ollama started with LAN access"
fi

sleep 2

LOCAL_IP=$(get_local_ip)

echo ""
echo "🌍 Access URLs:"
echo "   • http://localhost:11434"
if [ -n "$LOCAL_IP" ]; then
  echo "   • http://$LOCAL_IP:11434"
fi
echo ""

if [ "$OS_TYPE" = "windows" ]; then
  echo "💡 Tip: Ollama is running. To stop it, run:"
  echo "   taskkill //F //IM ollama.exe"
else
  echo "💡 Tip: Ollama is running in the background. To stop it, run:"
  echo "   pkill -f "ollama serve""
fi
echo ""`

const OLLAMA_ENV_SCRIPT_INSTRUCTIONS = `**Step 1:** Create the script file \`ollama-env.sh\`:

\`\`\`bash
${OLLAMA_ENV_SCRIPT_CONTENT}
\`\`\`

**Step 2:** Make it executable and run:

\`\`\`bash
# Make executable
chmod +x ollama-env.sh

# Run (macOS/Linux/Windows Git Bash/WSL)
./ollama-env.sh firefox   # Firefox with CORS + LAN access
./ollama-env.sh chrome     # Chrome with LAN access

# Windows PowerShell
bash ollama-env.sh firefox
\`\`\`

This script automatically:
- Detects your OS (macOS, Linux, Windows)
- Configures \`OLLAMA_HOST\` for LAN access
- Sets \`OLLAMA_ORIGINS\` for browser extensions
- Starts Ollama with the correct settings
- Shows your local IP address`

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

**Create and use our cross-platform helper script** - it automatically configures everything:

${OLLAMA_ENV_SCRIPT_INSTRUCTIONS}

**Or manually configure** (see platform-specific instructions below):

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

📖 For step-by-step instructions: [ollama-setup-guide](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide)  
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

### ⚡ Ollama Quick Setup: Use Helper Script (Recommended)

**The easiest way to start Ollama** with proper configuration:

${OLLAMA_ENV_SCRIPT_INSTRUCTIONS}

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
