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
#   ✅ macOS + Ollama.app: sets OLLAMA_ORIGINS in the launchd session env and
#      restarts the app, so its own server inherits CORS and keeps it across the
#      app's auto-relaunch (persists until logout)
#   ✅ Otherwise (CLI Ollama): stops the running server and starts its own with
#      OLLAMA_ORIGINS set for Chrome and Firefox extensions
#   ✅ Verifies the server is up AND actually allows the extension origin (an
#      Origin-header probe), so it never reports success on a non-CORS server
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

PORT="11434"
ORIGINS="chrome-extension://*,moz-extension://*"

# PIDs of processes LISTENing on the Ollama port (not browser client
# connections). Name-agnostic: the macOS app launches the server under a path
# that `pkill -f "ollama serve"` does not match, so we target the port instead.
port_listener_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

# Kill ONLY Ollama processes that hold the port. If some other program owns the
# port, refuse to touch it — blindly killing the port owner could terminate an
# unrelated local service and lose its unsaved state. Exits the script on a
# foreign holder so the caller does not proceed to start a server that cannot
# bind anyway.
kill_ollama_listeners() {
  local pid cmd ollama_pids="" foreign=""
  for pid in $(port_listener_pids); do
    cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
    # Process vanished between the lookup and now — nothing to do.
    [ -z "$cmd" ] && continue
    if printf '%s' "$cmd" | grep -qi "ollama"; then
      ollama_pids="$ollama_pids $pid"
    else
      foreign="$foreign
   • PID $pid: $cmd"
    fi
  done
  if [ -n "$foreign" ]; then
    echo "❌ Port $PORT is held by a non-Ollama process; refusing to kill it:$foreign"
    echo "   Free the port yourself, then re-run this script."
    exit 1
  fi
  # shellcheck disable=SC2086
  [ -n "$ollama_pids" ] && kill $ollama_pids 2>/dev/null || true
}

# Is a server answering at all (no Origin header — checks liveness only)?
server_up() {
  curl -sf "http://localhost:$PORT/api/version" >/dev/null 2>&1
}

# Does the running server actually allow the extension origin? A server without
# OLLAMA_ORIGINS returns 403 to a browser-extension Origin; a configured one
# returns 200. This is what distinguishes "up" from "up AND usable by the
# extension", so we never print a green check on a non-CORS server.
cors_ok() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Origin: moz-extension://cors-probe" \
    "http://localhost:$PORT/api/version" 2>/dev/null || echo "000")
  [ "$code" = "200" ]
}

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

# macOS + the Ollama.app: the app supervises its OWN `ollama serve` and
# relaunches itself (login item), so killing the server and starting our own is
# futile — the app comes back with a non-CORS server. Instead set the origin in
# the launchd session environment (which the app-spawned server inherits) and
# restart the app.
MACOS_APP=""
if [ "$OS_TYPE" = "macos" ] && [ -d "/Applications/Ollama.app" ]; then
  MACOS_APP="yes"
fi

if [ -n "$MACOS_APP" ]; then
  echo "ℹ️  Configuring the Ollama menu-bar app for extension CORS..."
  # Session-wide env the app's server inherits on launch. Persists until logout;
  # revert with: launchctl unsetenv OLLAMA_ORIGINS
  launchctl setenv OLLAMA_ORIGINS "$ORIGINS"
  if [ "$MODE" = "lan" ]; then
    launchctl setenv OLLAMA_HOST "0.0.0.0"
  else
    # Drop any stale LAN binding from a previous --lan run.
    launchctl unsetenv OLLAMA_HOST 2>/dev/null || true
  fi

  # Restart the app so its server picks up the new environment. It MUST be
  # fully dead (app process + server, port free) before we relaunch — otherwise
  # `open -a Ollama` no-ops on the still-running instance, which keeps its stale
  # env and CORS never applies. The app auto-relaunches, so force it if a plain
  # quit does not take.
  osascript -e 'quit app "Ollama"' 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    pgrep -x Ollama >/dev/null 2>&1 || break
    sleep 1
  done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! pgrep -x Ollama >/dev/null 2>&1 && [ -z "$(port_listener_pids)" ]; then
      break
    fi
    pkill -x Ollama 2>/dev/null || true
    kill_ollama_listeners
    sleep 1
  done
  open -a Ollama 2>/dev/null || true
else
  # No app (CLI-managed Ollama): stop the running server and start our own with
  # the env vars exported into this process.
  if [ "$OS_TYPE" = "windows" ]; then
    taskkill //F //IM ollama.exe 2>/dev/null || true
    sleep 1
  else
    kill_ollama_listeners
    pkill -f "ollama serve" 2>/dev/null || true
  fi

  # Wait for the port to free so our server can bind (and we don't mistake a
  # leftover non-CORS server for success).
  freed=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [ -z "$(port_listener_pids)" ]; then
      freed="yes"
      break
    fi
    sleep 1
  done
  if [ -z "$freed" ]; then
    echo "❌ Port $PORT is still in use after stopping Ollama — a supervisor is"
    echo "   respawning the server, so a new one with CORS settings cannot bind."
    echo "   Stop the service/supervisor managing Ollama, then re-run this script."
    echo "   Current listener(s): $(port_listener_pids | tr '\n' ' ')"
    exit 1
  fi

  export OLLAMA_ORIGINS="$ORIGINS"
  [ "$MODE" = "lan" ] && export OLLAMA_HOST="0.0.0.0"

  LOG_FILE="$HOME/.ollama-serve.log"
  nohup ollama serve > "$LOG_FILE" 2>&1 &
fi

# Verify: the server must be UP and actually allow the extension origin. A plain
# liveness check is not enough — a non-CORS server answers /api/version too.
started=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  if server_up && cors_ok; then
    started="yes"
    break
  fi
done

if [ -z "$started" ]; then
  if server_up; then
    echo "❌ A server is running on $PORT but it is rejecting the extension origin (403)."
    if [ -n "$MACOS_APP" ]; then
      echo "   The Ollama app did not pick up OLLAMA_ORIGINS. Fully quit it from the"
      echo "   menu bar, then re-run this script (launchctl env applies on next launch)."
    else
      echo "   Another Ollama (without OLLAMA_ORIGINS) owns the port. Stop it, then re-run."
    fi
  else
    echo "❌ Ollama did not start (no response on http://localhost:$PORT after 15s)."
    if [ -z "$MACOS_APP" ]; then
      echo "   Last log lines from ${LOG_FILE:-$HOME/.ollama-serve.log}:"
      tail -5 "${LOG_FILE:-$HOME/.ollama-serve.log}" 2>/dev/null | sed 's/^/   | /'
    fi
  fi
  exit 1
fi

if [ "$MODE" = "lan" ]; then
  echo "✅ Ollama started with extension CORS + LAN access"
else
  echo "✅ Ollama started with extension CORS (this machine only)"
fi

echo ""
echo "🌍 Access URLs:"
echo "   • http://localhost:$PORT"
if [ "$MODE" = "lan" ]; then
  LOCAL_IP=$(get_local_ip)
  if [ -n "$LOCAL_IP" ]; then
    echo "   • http://$LOCAL_IP:$PORT"
  fi
  echo ""
  echo "⚠️  LAN mode: anyone on your network can reach this server (Ollama has no auth)."
fi
echo ""

if [ -n "$MACOS_APP" ]; then
  echo "💡 The Ollama app now runs the server with CORS (persists until logout)."
  echo "   To stop: quit Ollama from the menu bar."
  echo "   To revert CORS: launchctl unsetenv OLLAMA_ORIGINS"
elif [ "$OS_TYPE" = "windows" ]; then
  echo "💡 Tip: Ollama is running. To stop it, run:"
  echo "   taskkill //F //IM ollama.exe"
else
  echo "💡 Tip: Ollama is running in the background. To stop it, run:"
  echo "   pkill -f \"ollama serve\""
fi
echo ""
