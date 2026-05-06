'use client';

import { useEffect, useState } from 'react';
import { Chrome, MessageCircle, X } from 'lucide-react';

/**
 * Dismissible info banners for the home page. Today: one for the
 * optional Claude-in-Chrome integration, one for the optional
 * Telegram fallback. We can't detect either side from inside the
 * web app (the Chrome extension doesn't expose a probe; Telegram
 * status lives in the daemon's env not the per-tab state), so we
 * show plain links + dismissible state instead of fancy detection.
 *
 * Dismissal goes to localStorage and never expires — the operator
 * has read the message; no need to re-pester.
 */

type BannerKey = 'chrome' | 'telegram';

const STORAGE_PREFIX = 'selfclaude.banner.dismissed.';

function isDismissed(key: BannerKey): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function setDismissed(key: BannerKey): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, '1');
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function InfoBanners() {
  // Hydration guard — banner state lives in localStorage, which is
  // unavailable on the server. We render nothing on first mount, then
  // flip to the real visibility check on the first effect tick. Avoids
  // SSR / client mismatch warnings + flash of dismissed banners.
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissedState] = useState<Record<BannerKey, boolean>>({
    chrome: true,
    telegram: true,
  });

  useEffect(() => {
    setDismissedState({
      chrome: isDismissed('chrome'),
      telegram: isDismissed('telegram'),
    });
    setHydrated(true);
  }, []);

  const dismiss = (key: BannerKey) => {
    setDismissed(key);
    setDismissedState((prev) => ({ ...prev, [key]: true }));
  };

  if (!hydrated) return null;
  const allDismissed = dismissed.chrome && dismissed.telegram;
  if (allDismissed) return null;

  return (
    <div className="space-y-2 mb-6">
      {!dismissed.chrome && (
        <Banner
          icon={<Chrome size={14} className="text-cyan-300" />}
          accent="cyan"
          title="Claude in Chrome"
          body={
            <>
              The supervisor can verify UI work + browse pages if you've installed{' '}
              <a
                href="https://claude.ai/chrome"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline hover:text-cyan-100"
              >
                Claude in Chrome
              </a>{' '}
              and granted permissions. Specialists don't get Chrome — that's intentional, sup
              holds the verification tool. (We can't detect whether the extension is installed,
              so this is just FYI.)
            </>
          }
          onDismiss={() => dismiss('chrome')}
        />
      )}
      {!dismissed.telegram && (
        <Banner
          icon={<MessageCircle size={14} className="text-emerald-300" />}
          accent="emerald"
          title="Telegram fallback"
          body={
            <>
              Questions or approvals you don't answer in 15 seconds can be forwarded to a
              Telegram chat. Set up a bot via{' '}
              <a
                href="https://core.telegram.org/bots#how-do-i-create-a-bot"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-300 underline hover:text-emerald-100"
              >
                @BotFather
              </a>
              , put the token in <code className="text-emerald-200/80">.env</code>, then run{' '}
              <code className="text-emerald-200/80">selfclaude link-telegram</code> to pair the
              chat.
            </>
          }
          onDismiss={() => dismiss('telegram')}
        />
      )}
    </div>
  );
}

function Banner({
  icon,
  accent,
  title,
  body,
  onDismiss,
}: {
  icon: React.ReactNode;
  accent: 'cyan' | 'emerald';
  title: string;
  body: React.ReactNode;
  onDismiss: () => void;
}) {
  const accentClass =
    accent === 'cyan'
      ? 'border-cyan-800/40 bg-cyan-950/20 text-cyan-100'
      : 'border-emerald-800/40 bg-emerald-950/20 text-emerald-100';
  const iconBgClass =
    accent === 'cyan'
      ? 'bg-cyan-900/40 border-cyan-700/40'
      : 'bg-emerald-900/40 border-emerald-700/40';
  return (
    <div
      className={`rounded-md border ${accentClass} px-3 py-2.5 flex items-start gap-3`}
      role="status"
    >
      <span
        className={`shrink-0 w-7 h-7 rounded-md border ${iconBgClass} flex items-center justify-center mt-0.5`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <h4 className="text-[12px] font-mono font-semibold mb-0.5">{title}</h4>
        <p className="text-[11px] leading-relaxed opacity-80">{body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-bg-elevated/40"
        aria-label="dismiss"
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}
