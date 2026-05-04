/**
 * Parse a Telegram reply text into an approval decision. Defaults to deny —
 * an ambiguous reply must NOT silently allow a destructive op.
 */
export function parseApprovalReply(text: string): 'allow' | 'deny' {
  const trimmed = text.trim().toLowerCase();
  if (/^(?:y|yes|allow|ok|okay|onay|evet|tamam|approve|approved)\b/.test(trimmed)) {
    return 'allow';
  }
  return 'deny';
}
