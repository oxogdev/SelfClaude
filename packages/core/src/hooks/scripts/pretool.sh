#!/usr/bin/env bash
# SelfClaude PreToolUse hook bridge — relays the tool-call request to the
# orchestrator and forwards the orchestrator's permission decision back to
# Claude Code on stdout. On any error, exits 0 silently so the default
# permission flow takes over (no false-negative blocking).

set -uo pipefail

INPUT="$(cat)"
ROLE="${SELFCLAUDE_ROLE:-unknown}"
AGENT="${SELFCLAUDE_AGENT:-$ROLE}"
URL="${SELFCLAUDE_ORCH_URL:-}"

if [ -z "$URL" ]; then
  exit 0
fi

RESP="$(curl -fsS --max-time 600 \
  -X POST -H 'Content-Type: application/json' \
  -d "$INPUT" \
  "${URL}/hook/pretool?role=${ROLE}&agent=${AGENT}" 2>/dev/null)" || RESP=""

if [ -n "$RESP" ]; then
  printf '%s' "$RESP"
fi

exit 0
