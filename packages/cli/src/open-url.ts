import { spawn } from 'node:child_process';

/**
 * Best-effort: open a URL in the operator's default browser, handling
 * each platform's launcher correctly.
 *
 *   macOS  → `open <url>`
 *   Linux  → `xdg-open <url>`
 *   Windows→ `cmd /c start <url>`  (Node's spawn can't resolve `start`
 *                                    directly; cmd.exe is what knows it)
 *
 * Failures are swallowed because every call site is non-critical
 * (auto-open after `selfclaude start` — if it doesn't work, the URL is
 * still printed to stdout and the operator can paste it manually).
 *
 * Adopted from PR #1 (Ersin KOÇ — Windows installation work). The
 * orchestrator itself remains macOS + Linux-tested; Windows is opt-in
 * via the ps1 installer (not yet shipped) but having the helper land
 * here means subsequent Windows work doesn't need to chase down three
 * separate hardcoded `'open'` call sites.
 */
export function openUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // Assume xdg-open on Linux + other Unix-likes. If absent, the
      // operator sees the URL printed and can open it manually.
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* best effort */
  }
}
