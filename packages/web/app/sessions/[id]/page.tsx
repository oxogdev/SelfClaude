'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TabBar } from '@/components/tab-bar';
import { StatusBar } from '@/components/status-bar';
import { SupChat } from '@/components/sup-chat';
import { DevTimeline } from '@/components/dev-timeline';
import { ToolDetail } from '@/components/tool-detail';
import { Drawer } from '@/components/drawer';
import { InputBar } from '@/components/input-bar';
import { useSessionStore } from '@/lib/store';
import { subscribeSession } from '@/lib/sse';
import { api } from '@/lib/api';

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const session = useSessionStore((s) => s.sessions[id]);
  const setSnapshot = useSessionStore((s) => s.setSnapshot);
  const applyEvent = useSessionStore((s) => s.applyEvent);
  const selectTool = useSessionStore((s) => s.selectTool);
  const setActive = useSessionStore((s) => s.setActive);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setActive(id);
    let active = true;

    (async () => {
      try {
        const snap = await api.getSession(id);
        if (!active) return;
        setSnapshot(id, snap);
      } catch (e) {
        if (!active) return;
        setError((e as Error).message);
        return;
      }
    })();

    const sub = subscribeSession(
      id,
      (event) => applyEvent(id, event),
      () => setError('Lost connection (will retry automatically)'),
    );
    return () => {
      active = false;
      sub.close();
    };
  }, [id, setSnapshot, applyEvent, setActive]);

  const handleSupSubmit = async (text: string) => {
    if (!session) return;
    try {
      if (session.pendingQuestion) {
        await api.answerQuestion(id, session.pendingQuestion.id, text);
        return;
      }
      if (session.pendingApproval) {
        const decision = /^y(es)?$/i.test(text.trim()) ? 'allow' : 'deny';
        await api.decideApproval(id, session.pendingApproval.id, decision);
        return;
      }
      await api.sendMessage(id, text);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDevSubmit = async (text: string) => {
    try {
      await api.sendDevMessage(id, text);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 gap-4">
        <p className="text-red-300">{error}</p>
        <button
          onClick={() => router.push('/')}
          className="px-3 py-1 text-sm rounded border border-border hover:bg-bg-elevated"
        >
          ← Back to projects
        </button>
      </div>
    );
  }

  if (!session) {
    return <div className="p-8 text-zinc-500">Loading session…</div>;
  }

  const supWidth = '32%';
  const detailWidth = '28%';

  return (
    <div className="flex flex-col h-screen bg-bg">
      <TabBar />
      <StatusBar meta={session.meta} busy={session.busy} />
      <div className="flex-1 flex min-h-0">
        <div style={{ width: supWidth, minWidth: 320 }} className="border-r border-border flex flex-col">
          <SupChat chatLog={session.chatLog} streamingTs={session.streamingSupTs} />
        </div>
        <div className="flex-1 border-r border-border flex flex-col">
          <DevTimeline
            chatLog={session.chatLog}
            selectedToolUseId={session.selectedToolUseId}
            streamingTs={session.streamingDevTs}
            onSelectTool={(t) => selectTool(id, t)}
          />
        </div>
        <div style={{ width: detailWidth, minWidth: 280 }} className="flex flex-col">
          <ToolDetail
            chatLog={session.chatLog}
            selectedToolUseId={session.selectedToolUseId}
          />
        </div>
      </div>
      <Drawer
        question={session.pendingQuestion}
        approval={session.pendingApproval}
        onAnswer={(qid, answer) => api.answerQuestion(id, qid, answer)}
        onDecide={(aid, decision) => api.decideApproval(id, aid, decision)}
      />
      <div className="flex border-t border-border">
        <div style={{ width: supWidth, minWidth: 320 }} className="border-r border-border">
          <InputBar
            variant="sup"
            busy={session.busy}
            hasPendingQuestion={!!session.pendingQuestion}
            hasPendingApproval={!!session.pendingApproval}
            onSubmit={handleSupSubmit}
          />
        </div>
        <div className="flex-1">
          <InputBar
            variant="dev"
            busy={session.busy}
            onSubmit={handleDevSubmit}
          />
        </div>
      </div>
    </div>
  );
}
