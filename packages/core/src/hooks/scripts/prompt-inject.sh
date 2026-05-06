#!/usr/bin/env bash
# SelfClaude UserPromptSubmit hook bridge — drains the role's inbox from the
# orchestrator and prints back a JSON payload with `additionalContext` so the
# pending inter-agent messages get prepended to the model's context.

set -uo pipefail

INPUT="$(cat)"
ROLE="${SELFCLAUDE_ROLE:-unknown}"
AGENT="${SELFCLAUDE_AGENT:-$ROLE}"
URL="${SELFCLAUDE_ORCH_URL:-}"

if [ -z "$URL" ]; then
  exit 0
fi

RESP="$(curl -fsS --max-time 5 \
  -X POST -H 'Content-Type: application/json' \
  -d "$INPUT" \
  "${URL}/hook/prompt?role=${ROLE}&agent=${AGENT}" 2>/dev/null)" || RESP=""

if [ -n "$RESP" ]; then
  printf '%s' "$RESP"
fi

exit 0
