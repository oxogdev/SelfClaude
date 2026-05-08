import { API_BASE } from './api';
import type { SessionEvent } from './types';

export type SseSubscription = { close: () => void };

/**
 * Subscribe to a session's SSE stream. The handler is invoked for every
 * SessionEvent. Browser EventSource auto-reconnects on connection loss.
 *
 * Goes directly to the backend API (not via Next's rewrite proxy) because
 * dev-mode rewrites buffer SSE responses, which kills token streaming.
 */
export function subscribeSession(
  sessionId: string,
  handler: (event: SessionEvent) => void,
  onError?: (error: Event) => void,
): SseSubscription {
  const url = `${API_BASE}/api/sessions/${sessionId}/events`;
  const es = new EventSource(url);

  // Each event arrives with `event: <kind>` so we listen on each kind. Easier:
  // listen on the generic message handler when the server sends `event: kind`,
  // EventSource only fires the `message` listener if no event name is set, so
  // we need to bind every kind explicitly.
  const kinds: SessionEvent['kind'][] = [
    'state-changed',
    'user-message',
    'sup-message',
    'sup-message-delta',
    'dev-text',
    'dev-text-delta',
    'dev-tool-call',
    'dev-tool-result',
    'sup-tool-call',
    'sup-tool-result',
    'sup-thinking',
    'sup-thinking-delta',
    'dev-thinking',
    'dev-thinking-delta',
    'role-metrics',
    'task-marker',
    'phase-doc-written',
    'question',
    'question-resolved',
    'approval',
    'approval-resolved',
    'iteration-end',
    'turn-error',
    'session-stuck',
    'turn-busy',
    'user-note-dev',
    'user-message-dev',
    'wakeup-scheduled',
    'wakeup-fired',
    'wakeup-cancelled',
    'agent-text',
    'agent-text-delta',
    'agent-thinking',
    'agent-thinking-delta',
    'agent-tool-call',
    'agent-tool-result',
    'agent-summoned',
    'agent-dismissed',
    'verdict',
    'room-message',
    'phase-tracker-updated',
    'scripts-updated',
  ];

  for (const kind of kinds) {
    es.addEventListener(kind, (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as SessionEvent;
        if (
          typeof window !== 'undefined' &&
          (kind === 'sup-message-delta' || kind === 'dev-text-delta')
        ) {
          // Surfacing delta arrival in DevTools makes it easy to verify
          // streaming is wired end-to-end.
          // eslint-disable-next-line no-console
          console.debug(
            `[sse] ${kind}`,
            (parsed as { delta?: string }).delta?.slice(0, 60) ?? '',
          );
        }
        handler(parsed);
      } catch {
        /* ignore malformed event */
      }
    });
  }

  // EventSource's native 'error' listener fires on connection-level
  // problems (initial-connect failure, mid-stream drop). It also
  // fires for ANY server-sent custom event named 'error' — that
  // collision used to surface a spurious "Lost connection" toast on
  // every aborted turn. The orchestrator's turn-failure event is now
  // 'turn-error', but we still defensively gate the connection-error
  // handler on event-shape: a real connection error is a plain Event
  // (no `data`), while a server-sent custom event arrives as a
  // MessageEvent. If a future kind ever lands on 'error' again, the
  // guard catches it cleanly.
  if (onError) {
    es.addEventListener('error', (ev: Event) => {
      if (ev instanceof MessageEvent) return;
      onError(ev);
    });
  }

  return {
    close: () => es.close(),
  };
}
