import type { BrowseResult, SessionMeta, SessionSnapshot } from './types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${message}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health() {
    return jsonFetch<{ version: string; uptime: number; sessions: number }>('/api/health');
  },
  listSessions() {
    return jsonFetch<{ sessions: SessionMeta[] }>('/api/sessions');
  },
  createSession(cwd: string, label?: string) {
    return jsonFetch<SessionMeta>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ cwd, label }),
    });
  },
  destroySession(id: string) {
    return jsonFetch<void>(`/api/sessions/${id}`, { method: 'DELETE' });
  },
  getSession(id: string) {
    return jsonFetch<SessionSnapshot>(`/api/sessions/${id}`);
  },
  sendMessage(id: string, text: string) {
    return jsonFetch<{ accepted: boolean }>(`/api/sessions/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },
  answerQuestion(id: string, questionId: string, answer: string) {
    return jsonFetch<{ ok: boolean }>(`/api/sessions/${id}/answer-question`, {
      method: 'POST',
      body: JSON.stringify({ questionId, answer }),
    });
  },
  decideApproval(id: string, approvalId: string, decision: 'allow' | 'deny') {
    return jsonFetch<{ ok: boolean }>(`/api/sessions/${id}/decide-approval`, {
      method: 'POST',
      body: JSON.stringify({ approvalId, decision }),
    });
  },
  browse(path?: string) {
    const q = path ? `?path=${encodeURIComponent(path)}` : '';
    return jsonFetch<BrowseResult>(`/api/browse${q}`);
  },
};
