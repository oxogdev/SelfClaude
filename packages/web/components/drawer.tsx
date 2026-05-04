'use client';

import { AlertTriangle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PendingApproval, PendingQuestion } from '@/lib/types';

export function Drawer({
  question,
  approval,
  onAnswer,
  onDecide,
}: {
  question: PendingQuestion | null;
  approval: PendingApproval | null;
  onAnswer: (questionId: string, answer: string) => void;
  onDecide: (approvalId: string, decision: 'allow' | 'deny') => void;
}) {
  if (!question && !approval) return null;

  if (approval) {
    return (
      <div className="border-t border-red-700/40 bg-red-950/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-red-300">Approval requested</div>
            <code className="text-xs text-zinc-300 block mt-0.5 truncate">{approval.action}</code>
            <p className="text-xs text-zinc-500 mt-1">reason: {approval.reason}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => onDecide(approval.id, 'deny')}
              className="px-3 py-1 text-sm rounded border border-border hover:bg-bg-elevated"
            >
              Deny
            </button>
            <button
              onClick={() => onDecide(approval.id, 'allow')}
              className="px-3 py-1 text-sm rounded bg-red-700 hover:bg-red-600 text-white"
            >
              Allow
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (question) {
    return (
      <div className="border-t border-yellow-700/40 bg-yellow-950/20 px-4 py-3">
        <div className="flex items-start gap-3">
          <HelpCircle size={18} className="text-yellow-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-yellow-300">Supervisor asks</div>
            <p className="text-sm text-zinc-200 mt-1 whitespace-pre-wrap">{question.question}</p>
            {question.options && question.options.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {question.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => onAnswer(question.id, opt)}
                    className={cn(
                      'px-3 py-1 text-sm rounded border border-yellow-700/50 hover:bg-yellow-900/30',
                      'text-yellow-200',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            {(!question.options || question.options.length === 0) && (
              <p className="text-xs text-zinc-500 mt-1">type your answer in the input below</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
