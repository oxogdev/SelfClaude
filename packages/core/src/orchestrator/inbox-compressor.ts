/**
 * Phase 4 of ROADMAP.md (Context Efficiency) — sub-sprint 1.
 *
 * Heuristic compressor for messages flowing into sup's UserPromptSubmit
 * hook. The flow today:
 *
 *   developer / specialist agent finishes turn
 *     → enqueue full DEVELOPER_REPORT into supervisor inbox
 *     → on sup's next turn, hook drains inbox and prepends to user msg
 *     → CC subprocess sees the entire blob in the user message
 *
 * Long agent reports inflate that blob by 5-50× without proportional
 * decision content. The compressor sits between drain and join,
 * shortening narrative while preserving the parts sup actually needs
 * to act on.
 *
 * **What gets preserved verbatim** (per ROADMAP calibration #4 —
 * decisions never disappear):
 *   - Marker blocks: <VERDICT>…</VERDICT>, <TASK_RESULT>…</TASK_RESULT>,
 *     <<PHASE_COMPLETE>>, <<DISCOVERY_COMPLETE>>, <<READY_TO_EXECUTE>>
 *   - First N words (lead-in / context)
 *   - Last M words (conclusions / next-step asks)
 *
 * **What gets dropped**:
 *   - The middle of long narrative bodies, replaced with a
 *     `[…N tokens elided — full text in chat-log…]` placeholder so
 *     the operator can audit if needed.
 *
 * Heuristic, not LLM-based — correctness depends on testing the
 * marker-preservation rules against a fixture corpus. No external
 * calls; deterministic output.
 *
 * **Honest scope.** This compresses only what we inject into sup's
 * user message via the inbox path. CC's `--resume` mechanism replays
 * its own session history independently — those tokens are outside
 * our control until we add session checkpointing (deferred). The
 * realistic Phase 4 win is "halve the injected user message tokens",
 * not "halve total turn cost."
 */

/**
 * Markers that must survive compression intact. Each entry pairs an
 * opening pattern with a closing pattern (or `null` for self-closing
 * tokens like `<<PHASE_COMPLETE>>`). When a marker is found, the
 * entire span is preserved verbatim.
 */
interface PreservedMarker {
  /** Opening match pattern. */
  open: RegExp;
  /** Closing pattern; null for single-token markers. */
  close: RegExp | null;
  /** Human label for telemetry / debug. */
  label: string;
}

const PRESERVED_MARKERS: PreservedMarker[] = [
  // Yargısal Karar verdicts — load-bearing for cross-agent coordination.
  { open: /<VERDICT\s+id="(\d+)">/g, close: /<\/VERDICT>/g, label: 'verdict' },
  // Phase signals — orchestrator state transitions.
  { open: /<<DISCOVERY_COMPLETE>>/g, close: null, label: 'discovery-complete' },
  { open: /<<READY_TO_EXECUTE>>/g, close: null, label: 'ready-to-execute' },
  { open: /<<PHASE_COMPLETE>>/g, close: null, label: 'phase-complete' },
  // Task result envelopes (some agents emit these).
  { open: /<TASK_RESULT[\s>]/g, close: /<\/TASK_RESULT>/g, label: 'task-result' },
];

/**
 * Tokens-per-character heuristic. English text averages ~4 chars per
 * token across typical content. This is intentionally simple — we use
 * it for telemetry and threshold decisions, not for billing.
 */
const CHARS_PER_TOKEN = 4;

/** Estimate token count from a string. Words × 1.33 is the rule of thumb;
 * char-based is more stable across whitespace variations. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface CompressionOptions {
  /**
   * Bodies shorter than this (in chars) are returned verbatim. Default
   * 2000 — roughly 500 tokens, still cheap to ship in full.
   */
  minBytesToCompress?: number;
  /**
   * Number of leading characters to keep from the original body before
   * any preserved markers. Default 600 — enough for one full paragraph
   * plus a heading.
   */
  leadCharsToKeep?: number;
  /**
   * Number of trailing characters to keep after the last preserved
   * marker. Default 600 — captures conclusions / next-step asks.
   */
  tailCharsToKeep?: number;
}

export interface CompressionResult {
  /** Compressed body — drop-in replacement for the original. */
  body: string;
  /** Original length in characters. */
  originalBytes: number;
  /** Compressed length in characters. */
  compressedBytes: number;
  /** Estimate of tokens saved (informational; for telemetry). */
  tokensSaved: number;
  /** Marker labels found and preserved (deduped). */
  preservedMarkers: string[];
  /** True when the body was returned verbatim because it was below threshold. */
  bypassed: boolean;
}

/**
 * Compress a single inbox message body. See module-level comment for
 * the preservation rules. Output is always safe to inject as-is into
 * sup's user prompt.
 */
export function compressInboxMessage(
  body: string,
  opts: CompressionOptions = {},
): CompressionResult {
  const minBytes = opts.minBytesToCompress ?? 2000;
  const leadKeep = opts.leadCharsToKeep ?? 600;
  const tailKeep = opts.tailCharsToKeep ?? 600;

  if (body.length <= minBytes) {
    return {
      body,
      originalBytes: body.length,
      compressedBytes: body.length,
      tokensSaved: 0,
      preservedMarkers: [],
      bypassed: true,
    };
  }

  // Find every preserved-marker span. Each yields a [start, end, label]
  // triple covering the marker region (inclusive). Spans may overlap
  // when multiple markers share text — we merge them to keep output
  // contiguous.
  const spans: { start: number; end: number; label: string }[] = [];
  for (const marker of PRESERVED_MARKERS) {
    marker.open.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = marker.open.exec(body)) !== null) {
      const start = m.index;
      let end: number;
      if (marker.close === null) {
        end = m.index + m[0].length;
      } else {
        marker.close.lastIndex = m.index + m[0].length;
        const closeMatch = marker.close.exec(body);
        if (!closeMatch) {
          // Unmatched open — preserve everything from open to end of body
          // so we never lose the marker entirely.
          end = body.length;
        } else {
          end = closeMatch.index + closeMatch[0].length;
        }
      }
      spans.push({ start, end, label: marker.label });
    }
  }

  // Sort spans by start, merge overlaps.
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; labels: Set<string> }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      last.labels.add(span.label);
    } else {
      merged.push({ start: span.start, end: span.end, labels: new Set([span.label]) });
    }
  }

  // Build the compressed body. We keep:
  //   - body[0..leadKeep]
  //   - every preserved span (with the gap before it elided if too big)
  //   - body[-tailKeep..] (with the gap after the last span elided)
  //
  // To stay deterministic we serialize: lead → for each span: gap-elision
  // → span verbatim → after last span: tail elision → tail.

  const parts: string[] = [];
  let cursor = 0;
  // Lead.
  if (leadKeep > 0) {
    parts.push(body.slice(0, Math.min(leadKeep, body.length)));
    cursor = leadKeep;
  }

  for (const span of merged) {
    if (span.start > cursor) {
      const elided = span.start - cursor;
      if (elided > 200) {
        parts.push(`\n\n[…${elided} chars elided — full text in chat-log…]\n\n`);
      } else {
        // Small gap — cheaper to inline than to placeholder.
        parts.push(body.slice(cursor, span.start));
      }
    }
    parts.push(body.slice(span.start, span.end));
    cursor = span.end;
  }

  // Tail.
  const tailStart = Math.max(cursor, body.length - tailKeep);
  if (tailStart > cursor) {
    const elided = tailStart - cursor;
    if (elided > 200) {
      parts.push(`\n\n[…${elided} chars elided — full text in chat-log…]\n\n`);
    } else {
      parts.push(body.slice(cursor, tailStart));
    }
  }
  parts.push(body.slice(tailStart));

  const compressed = parts.join('');

  // If our compression somehow didn't shrink the body (lots of
  // preserved markers, short tails+leads relative to total), bail
  // back to the original. We promise compression OR no-op, never
  // expansion.
  if (compressed.length >= body.length) {
    return {
      body,
      originalBytes: body.length,
      compressedBytes: body.length,
      tokensSaved: 0,
      preservedMarkers: Array.from(new Set(merged.flatMap((s) => Array.from(s.labels)))),
      bypassed: true,
    };
  }

  const preservedMarkers = Array.from(
    new Set(merged.flatMap((s) => Array.from(s.labels))),
  ).sort();

  return {
    body: compressed,
    originalBytes: body.length,
    compressedBytes: compressed.length,
    tokensSaved: estimateTokens(body) - estimateTokens(compressed),
    preservedMarkers,
    bypassed: false,
  };
}
