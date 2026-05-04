/**
 * Destructive-operation policy.
 *
 * Pattern-matches Claude Code tool calls (PreToolUse hook input) against a
 * curated list of high-impact actions and decides whether to allow them
 * straight through or require explicit user approval.
 *
 * The list is intentionally narrow — false positives erode trust and slow
 * the loop down. New patterns should land here only after a real near-miss.
 * `require-approval` returns a human-readable reason and a short summary
 * suitable for the approval prompt.
 */

export interface ToolCall {
  toolName: string;
  toolInput: unknown;
}

export type PolicyAction = 'allow' | 'require-approval';

export interface PolicyDecision {
  action: PolicyAction;
  reason?: string;
  summary?: string;
}

const DANGEROUS_BASH_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+(?:[^|;&`\s]*\s+)*-[a-zA-Z]*[rRf][a-zA-Z]*\b/, reason: 'recursive/forced rm' },
  { re: /\brm\s+-[a-zA-Z]*[rRf][a-zA-Z]*\s/, reason: 'recursive/forced rm' },
  { re: /\bgit\s+push\s+(?:--force(?!-with-lease)|-f\b)/, reason: 'git force push' },
  { re: /\bgit\s+reset\s+--hard\b/, reason: 'git reset --hard' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*\b/, reason: 'git clean -f' },
  { re: /\bgit\s+branch\s+-D\b/, reason: 'git branch -D (force delete)' },
  { re: /\bdocker\s+compose\s+down\s+(?:[^|;&`\s]+\s+)*(?:-v\b|--volumes\b)/, reason: 'docker compose down -v (volume removal)' },
  { re: /\bdocker\s+(?:system|volume|image|container|builder)\s+prune\b/, reason: 'docker prune (data loss risk)' },
  { re: /\bdocker\s+volume\s+rm\b/, reason: 'docker volume rm' },
  { re: /\bdrop\s+(?:database|table|schema|index)\b/i, reason: 'SQL drop statement' },
  { re: /\btruncate\s+(?:table\s+)?[a-zA-Z_][a-zA-Z0-9_]*/i, reason: 'SQL truncate' },
  { re: /\bdelete\s+from\s+[a-zA-Z_]/i, reason: 'SQL delete from (no where guard)' },
  { re: /\bshred\b/, reason: 'shred (irrecoverable)' },
  { re: /\bdd\s+if=.*of=\/dev\/(?!null\b|zero\b|random\b|urandom\b)/, reason: 'dd to block device' },
  { re: /\bkill(?:all)?\s+-9\b/, reason: 'kill -9' },
  { re: /\bnpm\s+publish\b/, reason: 'npm publish (publishes package)' },
];

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /(?:^|\/)\.env(?:\..*)?$/,
  /(?:^|\/)credentials?\.json$/i,
  /(?:^|\/)\.ssh\//,
  /\.(?:pem|key|p12|pfx)$/i,
  /(?:^|\/)id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$/,
];

export function evaluatePolicy(call: ToolCall): PolicyDecision {
  if (call.toolName === 'Bash') {
    const command = String(
      (call.toolInput as { command?: unknown } | null | undefined)?.command ?? '',
    );
    for (const { re, reason } of DANGEROUS_BASH_PATTERNS) {
      if (re.test(command)) {
        return {
          action: 'require-approval',
          reason,
          summary: command.length > 120 ? `${command.slice(0, 117)}...` : command,
        };
      }
    }
    return { action: 'allow' };
  }
  if (call.toolName === 'Write' || call.toolName === 'Edit') {
    const path = String(
      (call.toolInput as { file_path?: unknown } | null | undefined)?.file_path ?? '',
    );
    for (const re of SENSITIVE_FILE_PATTERNS) {
      if (re.test(path)) {
        return {
          action: 'require-approval',
          reason: 'sensitive file write',
          summary: `${call.toolName} ${path}`,
        };
      }
    }
    return { action: 'allow' };
  }
  return { action: 'allow' };
}
