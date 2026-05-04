import type { SessionEvent } from './types';

export type SseSubscription = { close: () => void };

/**
 * Subscribe to a session's SSE stream. The handler is invoked for every
 * SessionEvent. Browser EventSource auto-reconnects on connection loss.
 */
export function subscribeSession(
  sessionId: string,
  handler: (event: SessionEvent) => void,
  onError?: (error: Event) => void,
): SseSubscription {
  const url = `/api/sessions/${sessionId}/events`;
  const es = new EventSource(url);

  // Each event arrives with `event: <kind>` so we listen on each kind. Easier:
  // listen on the generic message handler when the server sends `event: kind`,
  // EventSource only fires the `message` listener if no event name is set, so
  // we need to bind every kind explicitly.
  const kinds: SessionEvent['kind'][] = [
    'state-changed',
    'user-message',
    'sup-message',
    'dev-text',
    'dev-tool-call',
    'dev-tool-result',
    'task-marker',
    'phase-doc-written',
    'question',
    'question-resolved',
    'approval',
    'approval-resolved',
    'iteration-end',
    'error',
    'turn-busy',
    'user-note-dev',
  ];

  for (const kind of kinds) {
    es.addEventListener(kind, (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as SessionEvent;
        handler(parsed);
      } catch {
        /* ignore malformed event */
      }
    });
  }

  if (onError) es.addEventListener('error', onError);

  return {
    close: () => es.close(),
  };
}
