#!/usr/bin/env bash
set -euo pipefail

# The nightly live pass: a production build, the qualification suite in Docker
# against olc Codex (codex/gpt-6-luna, xhigh), then the gate. Run it from a
# scheduler on the machine signed in to Codex; see README "Nightly live suite".

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Working tree is dirty; a nightly pass only measures a clean commit." >&2
  exit 2
fi

pnpm build
suite_status=0
AUDIT_ATTEMPTS="${AUDIT_ATTEMPTS:-1}" \
  bash tools/agent-live-benchmark/run-live.docker.sh qualification || suite_status=$?
node tools/agent-live-benchmark/live-gate.mjs artifacts/agent-live-benchmark/qualification
if [[ "$suite_status" != 0 ]]; then
  echo "The pass recorded infrastructure failures (olc down, timeout or token cap)." >&2
  exit "$suite_status"
fi
