#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
playwright_version="$(node -e 'const p=require(process.argv[1]); const v=p.devDependencies?.["@playwright/test"] ?? p.dependencies?.["@playwright/test"]; if (!v || !/^\d+\.\d+\.\d+$/.test(v)) { console.error("@playwright/test must be pinned to an exact version"); process.exit(1) } console.log(v)' "$repository_root/package.json")"
docker_image="${AGENT_BENCHMARK_DOCKER_IMAGE:-mcr.microsoft.com/playwright:v${playwright_version}-noble}"
host_base_url="${AGENT_HOSTED_BASE_URL:-http://127.0.0.1:${AGENT_BENCHMARK_OLC_PORT:-18083}}"
nanobrowser_extension_host="${NANOBROWSER_EXTENSION_PATH:-}"
output_root="${AGENT_BENCHMARK_RUNS_DIR:-artifacts/e2e/benchmark-runs}"
run_id="${AGENT_BENCHMARK_RUN_ID:-docker-$(date -u '+%Y%m%dT%H%M%SZ')}"
compare_to=""
products="ollama-client nanobrowser"
runner_args=()

usage() {
  cat <<'USAGE'
Run the agent benchmark inside the Playwright Docker image matching this repo.

Usage:
  pnpm benchmark:agent:comparison:docker [the usual benchmark options]

Additional options:
  --compare-to <merged.json>  Compare Nanobrowser with an existing Ollama Client report
  --run-id <id>               Name this output folder (default: generated docker timestamp)

The Docker image can be overridden with AGENT_BENCHMARK_DOCKER_IMAGE.
The runner-owned loopback olc port defaults to 18083 and can be set with
AGENT_BENCHMARK_OLC_PORT; --base-url overrides it.
USAGE
}

while (($#)); do
  case "$1" in
    --help)
      usage
      exit 0
      ;;
    --nanobrowser-extension)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected a host path after --nanobrowser-extension." >&2
        exit 2
      fi
      nanobrowser_extension_host="$2"
      shift 2
      ;;
    --base-url)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected a URL after --base-url." >&2
        exit 2
      fi
      host_base_url="$2"
      shift 2
      ;;
    --output-dir)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected a path after --output-dir." >&2
        exit 2
      fi
      output_root="$2"
      shift 2
      ;;
    --run-id)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected an id after --run-id." >&2
        exit 2
      fi
      run_id="$2"
      shift 2
      ;;
    --compare-to)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected a merged report path after --compare-to." >&2
        exit 2
      fi
      compare_to="$2"
      shift 2
      ;;
    --only)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected a product after --only." >&2
        exit 2
      fi
      products="$2"
      runner_args+=(--only "$2")
      shift 2
      ;;
    --reasoning-effort)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected a reasoning effort after --reasoning-effort." >&2
        exit 2
      fi
      reasoning_effort="$2"
      runner_args+=(--reasoning-effort "$2")
      shift 2
      ;;
    --model)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "Expected a model id after --model." >&2
        exit 2
      fi
      runner_args+=(--model "$2")
      shift 2
      ;;
    --skip-build)
      runner_args+=(--skip-build)
      shift
      ;;
    --)
      shift
      runner_args+=("$@")
      break
      ;;
    *)
      echo "Unknown Docker-runner option '$1'. Use --help." >&2
      exit 2
      ;;
  esac
done

if [[ "$products" == *nanobrowser* ]]; then
  if [[ -z "$nanobrowser_extension_host" ]]; then
    echo "Set NANOBROWSER_EXTENSION_PATH or pass --nanobrowser-extension." >&2
    exit 2
  fi
  if [[ ! -f "$nanobrowser_extension_host/manifest.json" ]]; then
    echo "Nanobrowser manifest not found at: $nanobrowser_extension_host" >&2
    exit 2
  fi
  nanobrowser_extension_host="$(cd "$nanobrowser_extension_host" && pwd)"
fi

host_output_root="$(node -e 'const path=require("node:path"); const root=process.argv[1]; const out=path.resolve(root,process.argv[2]); if(out!==root && !out.startsWith(root+path.sep)){console.error("Docker benchmark output must be inside the repository so artifacts can be saved on the host"); process.exit(2)} console.log(out)' "$repository_root" "$output_root")"
container_output_root="$(node -e 'const path=require("node:path"); const root=process.argv[1]; const out=process.argv[2]; console.log(path.join("/workspace",path.relative(root,out)))' "$repository_root" "$host_output_root")"
container_base_url="$(node -e 'const u=new URL(process.argv[1]); if(["127.0.0.1","localhost","[::1]","::1"].includes(u.hostname)) u.hostname="host.docker.internal"; if(u.pathname==="/v1"||u.pathname==="/v1/")u.pathname=""; console.log(u.toString().replace(/\/$/,""))' "$host_base_url")"
host_base_url="$(node -e 'const u=new URL(process.argv[1]); if(u.pathname==="/v1"||u.pathname==="/v1/")u.pathname=""; console.log(u.toString().replace(/\/$/,""))' "$host_base_url")"
olc_port="$(node -e 'const u=new URL(process.argv[1]); console.log(u.port||(u.protocol==="https:"?"443":"80"))' "$host_base_url")"

if [[ ! "$run_id" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$ ]]; then
  echo "Run id must start with a letter or number and contain only letters, numbers, dots, underscores or dashes." >&2
  exit 2
fi

case "$host_base_url" in
  http://127.0.0.1:*|https://127.0.0.1:*|http://localhost:*|https://localhost:*|http://\[::1\]:*|https://\[::1\]:*)
    local_olc=true
    ;;
  *)
    local_olc=false
    ;;
esac

health_url="${host_base_url%/}/health"
health_backend() {
  local payload
  payload="$(curl -fsS --max-time 2 "$health_url" 2>/dev/null)" || return 1
  node -e 'try { const value=JSON.parse(process.argv[1]); console.log(value.backend??"") } catch { process.exit(1) }' "$payload"
}

if ! docker info >/dev/null 2>&1; then
  docker desktop start
  ready=false
  for _ in $(seq 1 180); do
    if docker info >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    echo "Docker Desktop did not become ready. Check 'docker desktop status'." >&2
    exit 1
  fi
fi

artifact_directory="$host_output_root/$run_id"
mkdir -p "$artifact_directory"
if [[ -n "$nanobrowser_extension_host" ]]; then
  staged_extension="$artifact_directory/input/nanobrowser-extension"
  mkdir -p "$staged_extension"
  cp -R "$nanobrowser_extension_host/." "$staged_extension/"
  nanobrowser_extension_host="$staged_extension"
fi
docker_log="$artifact_directory/docker.log"
olc_log="$artifact_directory/olc-codex.log"
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

backend=""
backend="$(health_backend || true)"
if [[ -n "$backend" && "$backend" != codex ]]; then
  echo "Service at $host_base_url is '$backend', expected the olc Codex backend." >&2
  exit 1
fi
if [[ -z "$backend" ]]; then
  if [[ "$local_olc" != true ]]; then
    echo "No service answers at $host_base_url and it is not a loopback URL; start olc Codex first." >&2
    exit 1
  fi
  mkdir -p "$(dirname "$olc_log")"
  "$repository_root/node_modules/.bin/tsx" packages/olc/src/cli.ts --backend codex --debug --port "$olc_port" >"$olc_log" 2>&1 &
  olc_pid=$!
  for _ in $(seq 1 180); do
    backend="$(health_backend || true)"
    if [[ "$backend" == codex ]]; then break; fi
    if ! kill -0 "$olc_pid" 2>/dev/null; then
      echo "olc Codex exited before becoming ready; see $olc_log" >&2
      exit 1
    fi
    sleep 1
  done
  if [[ "$backend" != codex ]]; then
    echo "Timed out waiting for olc Codex at $host_base_url; see $olc_log" >&2
    exit 1
  fi
fi

docker_args=(
  run --rm --init --ipc=host --pids-limit="${AGENT_BENCHMARK_DOCKER_PIDS_LIMIT:-2048}"
  --mount "type=bind,source=$repository_root,target=/workspace"
  --mount "type=volume,source=ollama-client-benchmark-node-modules-v${playwright_version//./-},target=/workspace/node_modules"
  --mount "type=volume,source=ollama-client-benchmark-pnpm-store,target=/workspace/.pnpm-store"
  --workdir /workspace
  -e "AGENT_HOSTED_BASE_URL=$container_base_url"
  -e "AGENT_HOSTED_MODEL=${AGENT_HOSTED_MODEL:-codex/gpt-6-luna}"
  -e "AGENT_HOSTED_REASONING_EFFORT=${AGENT_HOSTED_REASONING_EFFORT:-medium}"
  -e "AGENT_BENCHMARK_RUNS_DIR=$container_output_root"
)
if [[ -n "$nanobrowser_extension_host" ]]; then
  docker_args+=(--mount "type=bind,source=$nanobrowser_extension_host,target=/nanobrowser-extension,readonly")
fi
container_args=("${runner_args[@]}" --base-url "$container_base_url" --output-dir "$container_output_root" --run-id "$run_id")
if [[ -n "$nanobrowser_extension_host" ]]; then
  container_args+=(--nanobrowser-extension /nanobrowser-extension)
fi

mkdir -p "$(dirname "$docker_log")"
printf 'image=%s\nplaywright_version=%s\nrun_id=%s\nbase_url=%s\n' "$docker_image" "$playwright_version" "$run_id" "$container_base_url" | tee "$docker_log"
set +e
docker "${docker_args[@]}" "$docker_image" /bin/bash -lc 'set -euo pipefail; CI=true corepack pnpm install --frozen-lockfile; corepack pnpm benchmark:agent:comparison "$@"' benchmark "${container_args[@]}" 2>&1 | tee -a "$docker_log"
benchmark_status=${PIPESTATUS[0]}
set -e

cat > "$artifact_directory/docker.json" <<EOF
{
  "image": "$docker_image",
  "playwrightVersion": "$playwright_version",
  "hostArchitecture": "$(uname -m)",
  "runId": "$run_id",
  "olcPort": "$olc_port",
  "containerBaseUrl": "$container_base_url",
  "benchmarkExitCode": $benchmark_status,
  "finishedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
EOF

if [[ -n "$compare_to" ]]; then
  baseline_path="$(node -e 'console.log(require("node:path").resolve(process.argv[1],process.argv[2]))' "$repository_root" "$compare_to")"
  candidate_directory="$artifact_directory/nanobrowser/merged"
  candidate_reports=("$candidate_directory"/agent-benchmark-*.json)
  if [[ ! -f "$baseline_path" ]]; then
    echo "Comparison baseline not found: $baseline_path" | tee -a "$docker_log" >&2
    exit 2
  fi
  if [[ -f "${candidate_reports[0]}" ]]; then
    "$repository_root/node_modules/.bin/tsx" tools/benchmarks/compare-agent-benchmark-reports.ts \
      "$baseline_path" "${candidate_reports[0]}" "$artifact_directory/comparison" \
      2>&1 | tee "$artifact_directory/comparison.log"
  else
    echo "No merged Nanobrowser report was written; comparison skipped." | tee -a "$docker_log" >&2
  fi
fi

exit "$benchmark_status"
