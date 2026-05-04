#!/usr/bin/env bash
# SelfClaude Stop hook bridge — POSTs the hook payload to the orchestrator and
# exits 0 unconditionally so the host turn never blocks on the hook.

set -uo pipefail

INPUT="$(cat)"
ROLE="${SELFCLAUDE_ROLE:-unknown}"
URL="${SELFCLAUDE_ORCH_URL:-}"

if [ -n "$URL" ]; then
  curl -fsS --max-time 5 \
    -X POST -H 'Content-Type: application/json' \
    -d "$INPUT" \
    "${URL}/hook/stop?role=${ROLE}" \
    >/dev/null 2>&1 || true
fi

exit 0
