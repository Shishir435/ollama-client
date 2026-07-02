#!/bin/bash

# Cross-platform Ollama environment setup script
# Starts Ollama with CORS configured for browser extensions (Chrome + Firefox).
# Works on macOS, Linux, and Windows (with Git Bash/WSL)
#
# ⚡ QUICK START (Easiest Method):
#   This script automatically configures Ollama for browser extensions.
#   It's the simplest way to get started with CORS setup!
#
# Usage:
#   ./tools/ollama-env.sh [--lan]
#
#   (no args)   Extension CORS enabled, server bound to 127.0.0.1 (this machine only)
#   --lan       Also bind to 0.0.0.0 so other devices on your network can connect.
#               ⚠️  Ollama has no authentication — only use --lan on networks you trust.
#
# Cross-platform Examples:
#   # macOS/Linux/Windows (Git Bash/WSL):
#   ./tools/ollama-env.sh
#   ./tools/ollama-env.sh --lan
#
#   # Windows (PowerShell/CMD):
#   bash tools/ollama-env.sh
#
# What this script does:
#   ✅ Detects your OS (macOS, Linux, Windows)
#   ✅ Stops any running Ollama instances (including the macOS menu-bar app,
#      which would otherwise restart the server without these settings)
#   ✅ Sets OLLAMA_ORIGINS for Chrome and Firefox extensions
#   ✅ Starts Ollama in the background and verifies it is actually up
#   ✅ With --lan: sets OLLAMA_HOST=0.0.0.0 and shows your local IP
#
# Requirements:
#   - Ollama must be installed: https://ollama.com
#   - Bash shell (pre-installed on macOS/Linux, Git Bash on Windows)
#
# Note for systemd installs (Linux): if Ollama runs as a systemd service, this
# script cannot inject env vars into it. Configure the service instead:
#   sudo systemctl edit ollama
#   [Service]
#   Environment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*"
#   sudo systemctl restart ollama

set -u

MODE="local"
case "${1:-}" in
  "") ;;
  --lan|lan) MODE="lan" ;;
  # Old invocations: both modes now always set extension CORS origins.
  firefox|chrome)
    echo "ℹ️  '$1' mode is deprecated — CORS for Chrome AND Firefox extensions is now always enabled."
    echo "   Use no argument (local only) or --lan (network access)."
    ;;
  -h|--help)
    sed -n '3,45p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "❌ Unknown argument: '$1'"
    echo "   Usage: $0 [--lan]"
    exit 1
    ;;
esac

# Detect OS
OS="$(uname -s)"
case "${OS}" in
  Linux*)     OS_TYPE="linux" ;;
  Darwin*)    OS_TYPE="macos" ;;
  MINGW*|MSYS*|CYGWIN*) OS_TYPE="windows" ;;
  *)          OS_TYPE="unknown" ;;
esac

# Warn when Ollama is managed by systemd — killing it here is pointless
# (systemd restarts it without our env vars).
if [ "$OS_TYPE" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet ollama 2>/dev/null; then
    echo "❌ Ollama is running as a systemd service. This script cannot set its env vars."
    echo "   Configure the service instead (see the note at the top of this script),"
    echo "   or stop it first: sudo systemctl stop ollama"
    exit 1
  fi
fi

# Stop existing Ollama instances.
if [ "$OS_TYPE" = "windows" ]; then
  taskkill //F //IM ollama.exe 2>/dev/null || true
else
  if [ "$OS_TYPE" = "macos" ] && pgrep -x Ollama >/dev/null 2>&1; then
    # The menu-bar app supervises `ollama serve` and would relaunch it
    # WITHOUT our env vars right after pkill — quit the app first.
    echo "ℹ️  Quitting the Ollama menu-bar app (it would restart the server without CORS settings)..."
    osascript -e 'quit app "Ollama"' 2>/dev/null || true
    sleep 2
  fi
  pkill -f "ollama serve" 2>/dev/null || true
fi

sleep 1

# Allow browser extensions (Chrome + Firefox) to call the API.
export OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"

if [ "$MODE" = "lan" ]; then
  # Bind to all interfaces so LAN devices can access it.
  export OLLAMA_HOST="0.0.0.0"
fi

# Get local IP address (cross-platform)
get_local_ip() {
  if [ "$OS_TYPE" = "macos" ]; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo ""
  elif [ "$OS_TYPE" = "linux" ]; then
    local ip
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$ip" ]; then
      ip=$(ip -4 addr show 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '^127\.' | head -1)
    fi
    echo "$ip"
  elif [ "$OS_TYPE" = "windows" ]; then
    ipconfig 2>/dev/null | grep -i "IPv4" | head -1 | grep -oE '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' | head -1 || echo ""
  else
    echo ""
  fi
}

LOG_FILE="$HOME/.ollama-serve.log"
nohup ollama serve > "$LOG_FILE" 2>&1 &

# Verify the server actually came up (catches port-in-use, respawned app
# instances, missing binary, etc. — don't print ✅ on faith).
started=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -sf http://localhost:11434/api/version >/dev/null 2>&1; then
    started="yes"
    break
  fi
done

if [ -z "$started" ]; then
  echo "❌ Ollama did not start (no response on http://localhost:11434 after 10s)."
  echo "   Last log lines from $LOG_FILE:"
  tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/   | /'
  exit 1
fi

if [ "$MODE" = "lan" ]; then
  echo "✅ Ollama started with extension CORS + LAN access"
else
  echo "✅ Ollama started with extension CORS (this machine only)"
fi

echo ""
echo "🌍 Access URLs:"
echo "   • http://localhost:11434"
if [ "$MODE" = "lan" ]; then
  LOCAL_IP=$(get_local_ip)
  if [ -n "$LOCAL_IP" ]; then
    echo "   • http://$LOCAL_IP:11434"
  fi
  echo ""
  echo "⚠️  LAN mode: anyone on your network can reach this server (Ollama has no auth)."
fi
echo ""

if [ "$OS_TYPE" = "windows" ]; then
  echo "💡 Tip: Ollama is running. To stop it, run:"
  echo "   taskkill //F //IM ollama.exe"
else
  echo "💡 Tip: Ollama is running in the background. To stop it, run:"
  echo "   pkill -f \"ollama serve\""
fi
echo ""
