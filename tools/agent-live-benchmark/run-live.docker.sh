#!/usr/bin/env bash
set -euo pipefail

# Runs a live agent suite in the Playwright Docker image against the olc Codex
# proxy on the host. The model and effort default to codex/gpt-6-luna at
# high; no API key is involved, Codex signs in through its own CLI.

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

usage() {
  cat <<'USAGE'
Usage: bash tools/agent-live-benchmark/run-live.docker.sh <qualification|synthetic|real-sites>

Environment (all optional):
  AUDIT_MODEL             default codex/gpt-6-luna
  AUDIT_REASONING_EFFORT  default high
  AUDIT_ATTEMPTS          attempts per task (harness default 3)
  AUDIT_SPLIT             qualification split: development or held_out
  AUDIT_ONLY              comma-separated task ids
  AUDIT_TASK_TIMEOUT_MS   per-task harness deadline, default 45 minutes
  AUDIT_MAX_TOKENS        stop starting attempts past this many reported tokens
  AUDIT_MAX_COST_USD      the same for reported cost (olc reports tokens only)
  AGENT_LIVE_OLC_PORT     olc Codex port on the host, default 8083; reused when
                          already running, started (and stopped after) otherwise
  AGENT_BENCHMARK_DOCKER_IMAGE  override the Playwright image

  AUDIT_SKIP_BUILD        1 refuses to run on a stale build instead of rebuilding

The suite loads build/chrome-mv3-prod, rebuilt first whenever source, config
or dependencies changed since it was built. A per-task summary prints at the
end, and baseline.md in the run directory carries the same tables.
USAGE
}

suite="${1:-}"
case "$suite" in
  qualification|synthetic|real-sites) ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

# The suite loads build/chrome-mv3-prod as it is, so a build older than the
# source measures old code while the report names the current commit. Any
# source, config or dependency file newer than the build's manifest rebuilds it.
build_manifest=build/chrome-mv3-prod/manifest.json
changed_source=""
if [[ -f "$build_manifest" ]]; then
  changed_source="$(find src packages config wxt.config.ts package.json pnpm-lock.yaml \
    -newer "$build_manifest" -type f -not -path '*/__tests__/*' -not -path '*/node_modules/*' \
    -print -quit 2>/dev/null || true)"
fi
if [[ ! -f "$build_manifest" || -n "$changed_source" ]]; then
  if [[ "${AUDIT_SKIP_BUILD:-}" == 1 ]]; then
    echo "build/chrome-mv3-prod is missing or older than ${changed_source:-the source}; unset AUDIT_SKIP_BUILD or run pnpm build." >&2
    exit 2
  fi
  echo "Building build/chrome-mv3-prod${changed_source:+ ($changed_source changed since the last build)}..." >&2
  pnpm build >/dev/null
fi

playwright_version="$(node -e 'const p=require(process.argv[1]); const v=p.devDependencies?.["@playwright/test"] ?? p.dependencies?.["@playwright/test"]; if (!v || !/^\d+\.\d+\.\d+$/.test(v)) { console.error("@playwright/test must be pinned to an exact version"); process.exit(1) } console.log(v)' "$repository_root/package.json")"
docker_image="${AGENT_BENCHMARK_DOCKER_IMAGE:-mcr.microsoft.com/playwright:v${playwright_version}-noble}"
olc_port="${AGENT_LIVE_OLC_PORT:-8083}"
host_base_url="http://127.0.0.1:${olc_port}"

if [[ "$(uname -s)" == Linux ]]; then
  container_base_url="$host_base_url"
  network_args=(--network host)
else
  container_base_url="http://host.docker.internal:${olc_port}"
  network_args=()
fi

health_backend() {
  local payload
  payload="$(curl -fsS --max-time 2 "$host_base_url/health" 2>/dev/null)" || return 1
  node -e 'try { console.log(JSON.parse(process.argv[1]).backend ?? "") } catch { process.exit(1) }' "$payload"
}

if ! docker info >/dev/null 2>&1; then
  docker desktop start
  for _ in $(seq 1 180); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || {
    echo "Docker did not become ready." >&2
    exit 1
  }
fi

log_directory="artifacts/agent-live-benchmark/logs"
mkdir -p "$log_directory"
stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
olc_log="$log_directory/olc-codex-$stamp.log"
olc_pid=""
stop_started_olc() {
  if [[ -n "$olc_pid" ]] && kill -0 "$olc_pid" 2>/dev/null; then
    kill -TERM "$olc_pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$olc_pid" 2>/dev/null || return 0
      sleep 1
    done
    kill -KILL "$olc_pid" 2>/dev/null || true
  fi
}
trap stop_started_olc EXIT INT TERM

backend="$(health_backend || true)"
if [[ -n "$backend" && "$backend" != codex ]]; then
  echo "Port $olc_port serves the '$backend' backend, not Codex. Set AGENT_LIVE_OLC_PORT." >&2
  exit 1
fi
if [[ -z "$backend" ]]; then
  "$repository_root/node_modules/.bin/tsx" packages/olc/src/cli.ts --backend codex --debug --port "$olc_port" >"$olc_log" 2>&1 &
  olc_pid=$!
  for _ in $(seq 1 180); do
    backend="$(health_backend || true)"
    [[ "$backend" == codex ]] && break
    if ! kill -0 "$olc_pid" 2>/dev/null; then
      echo "olc Codex exited before becoming ready; see $olc_log" >&2
      exit 1
    fi
    sleep 1
  done
  if [[ "$backend" != codex ]]; then
    echo "Timed out waiting for olc Codex on port $olc_port; see $olc_log" >&2
    exit 1
  fi
fi

env_args=(
  -e "AUDIT_UPSTREAM=$container_base_url"
  -e "AUDIT_MODEL=${AUDIT_MODEL:-codex/gpt-6-luna}"
  -e "AUDIT_REASONING_EFFORT=${AUDIT_REASONING_EFFORT:-high}"
)
for name in AUDIT_ATTEMPTS AUDIT_SPLIT AUDIT_ONLY AUDIT_TASK_TIMEOUT_MS AUDIT_MAX_TOKENS AUDIT_MAX_COST_USD AUDIT_DEBUG_EVIDENCE; do
  if [[ -n "${!name:-}" ]]; then env_args+=(-e "$name=${!name}"); fi
done

set +e
docker run --rm --init --ipc=host \
  --pids-limit="${AGENT_BENCHMARK_DOCKER_PIDS_LIMIT:-2048}" \
  ${network_args[@]+"${network_args[@]}"} \
  --mount "type=bind,source=$repository_root,target=/workspace" \
  --mount "type=volume,source=ollama-client-benchmark-node-modules-v${playwright_version//./-},target=/workspace/node_modules" \
  --mount "type=volume,source=ollama-client-benchmark-pnpm-store,target=/workspace/.pnpm-store" \
  --workdir /workspace \
  "${env_args[@]}" \
  "$docker_image" \
  /bin/bash -lc 'set -euo pipefail; CI=true corepack pnpm install --frozen-lockfile >/dev/null; git config --global --add safe.directory /workspace; node "tools/agent-live-benchmark/$1.mjs"' \
  live "$suite" 2>&1 | tee "$log_directory/$suite-$stamp.log"
status=${PIPESTATUS[0]}
set -e
exit "$status"
