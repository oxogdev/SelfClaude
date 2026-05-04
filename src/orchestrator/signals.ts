export type SignalKind = 'discovery-complete' | 'ready-to-execute' | 'phase-complete';

const SIGNAL_TOKENS: { kind: SignalKind; re: RegExp }[] = [
  { kind: 'discovery-complete', re: /<<DISCOVERY_COMPLETE>>/g },
  { kind: 'ready-to-execute', re: /<<READY_TO_EXECUTE>>/g },
  { kind: 'phase-complete', re: /<<PHASE_COMPLETE>>/g },
];

export interface SignalExtractionResult {
  /** Distinct signal kinds present in the text (deduped; order matches the list above). */
  signals: SignalKind[];
  /** The supervisor's text with all signal tokens stripped out and blank-line runs collapsed. */
  remainingText: string;
}

/**
 * Extract phase-control signals from a supervisor message and strip them from
 * the user-facing text. Tokens are deliberately distinctive (`<<NAME>>`) so
 * they don't collide with prose or markdown.
 */
export function extractSignals(text: string): SignalExtractionResult {
  const signals: SignalKind[] = [];
  let remaining = text;
  for (const { kind, re } of SIGNAL_TOKENS) {
    if (re.test(text)) {
      signals.push(kind);
      remaining = remaining.replace(re, '');
    }
  }
  remaining = remaining.replace(/\n{3,}/g, '\n\n').trim();
  return { signals, remainingText: remaining };
}
