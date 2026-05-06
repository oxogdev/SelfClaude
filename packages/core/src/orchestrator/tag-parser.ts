/**
 * Tag parser for the supervisor's outgoing messages.
 *
 * Two tag families today:
 *
 *   <TASK_FOR_DEVELOPER>...</TASK_FOR_DEVELOPER>
 *   <TASK_FOR_DEVELOPER agent="ui-dev">...</TASK_FOR_DEVELOPER>
 *
 *     Delegates work to a specific agent role. When `agent="..."` is
 *     omitted the task is routed to the default `developer` role
 *     (backward-compat with single-agent sessions).
 *
 *   <SUMMON agent="ui-dev"/>      <SUMMON agent="security"/>
 *   <DISMISS agent="ui-dev"/>     <DISMISS agent="security"/>
 *
 *     Lifecycle hints from the supervisor: "spin up this specialist for
 *     the next phase" / "this specialist is done, retire it". The
 *     orchestrator uses these to manage the active-agent set surfaced
 *     to the UI as tabs.
 *
 * Whitespace handling: empty task bodies are dropped, the remaining
 * supervisor text is collapsed to single blank lines (the tags occupy
 * their own lines in practice, leaving double-blanks behind).
 */

/**
 * Open tag matcher capturing both optional attributes:
 *   • `agent="..."`     — which specialist gets the task
 *   • `parallel="true"` — opt-in to concurrent execution with sibling
 *                         tasks (default: serial)
 *
 * The capture groups are positional, so the regex is intentionally
 * permissive about attribute order ("agent first" or "parallel first"
 * both work).
 */
const TASK_RE =
  /<TASK_FOR_DEVELOPER((?:\s+(?:agent\s*=\s*"[\w-]+"|parallel\s*=\s*"[^"]*"))*)\s*>([\s\S]*?)<\/TASK_FOR_DEVELOPER>/g;
const TASK_AGENT_RE = /agent\s*=\s*"([\w-]+)"/;
const TASK_PARALLEL_RE = /parallel\s*=\s*"([^"]*)"/;

const SUMMON_RE = /<SUMMON\s+agent\s*=\s*"([\w-]+)"\s*\/?>(?:\s*<\/SUMMON>)?/g;
const DISMISS_RE = /<DISMISS\s+agent\s*=\s*"([\w-]+)"\s*\/?>(?:\s*<\/DISMISS>)?/g;
const VERDICT_RE = /<VERDICT\s+id\s*=\s*"(\d+)"\s*>([\s\S]*?)<\/VERDICT>/g;

/**
 * One delegated task plus the agent it should reach. `agent` defaults to
 * "developer" when the tag had no explicit attribute — keeps existing
 * sessions working without a sup-prompt change. `parallel` defaults to
 * `false`; when true, the orchestrator may run this task concurrently
 * with other parallel-flagged siblings in the same supervisor turn.
 */
export interface DelegatedTask {
  agent: string;
  body: string;
  parallel: boolean;
}

/**
 * One supervisor "Yargısal Karar" — a numbered binding decision the sup
 * declared via `<VERDICT id="N">…</VERDICT>`. The orchestrator persists
 * these and broadcasts each one's text to every active specialist's
 * inbox so the agents pick the decision up on their next turn.
 */
export interface VerdictDecision {
  id: number;
  text: string;
}

export interface TagExtractionResult {
  /** Tasks delegated by the supervisor, in order. */
  tasks: DelegatedTask[];
  /** Agents the supervisor explicitly asked the orchestrator to summon. */
  summonedAgents: string[];
  /** Agents the supervisor explicitly asked the orchestrator to dismiss. */
  dismissedAgents: string[];
  /** Numbered moderator decisions broadcast to all active agents. */
  verdicts: VerdictDecision[];
  /** Supervisor text with all tags removed and blank-line runs normalized. */
  remainingText: string;
}

/**
 * Parse a supervisor message into structured delegations + lifecycle
 * hints + residual narrative. Empty/whitespace-only task bodies are
 * silently discarded; duplicate summon/dismiss for the same agent are
 * deduped (the orchestrator only needs one signal).
 */
export function extractDeveloperTasks(text: string): TagExtractionResult {
  const tasks: DelegatedTask[] = [];
  for (const match of text.matchAll(TASK_RE)) {
    const attrs = match[1] ?? '';
    const body = match[2]?.trim();
    if (!body) continue;
    const agentMatch = attrs.match(TASK_AGENT_RE);
    const parallelMatch = attrs.match(TASK_PARALLEL_RE);
    const agent = (agentMatch?.[1] ?? 'developer').trim();
    const parallel = parallelMatch?.[1]?.trim().toLowerCase() === 'true';
    tasks.push({ agent, body, parallel });
  }

  const summoned = new Set<string>();
  for (const match of text.matchAll(SUMMON_RE)) {
    if (match[1]) summoned.add(match[1]);
  }
  const dismissed = new Set<string>();
  for (const match of text.matchAll(DISMISS_RE)) {
    if (match[1]) dismissed.add(match[1]);
  }

  const verdicts: VerdictDecision[] = [];
  // Verdict ids dedupe in input order — if the sup re-stated the same
  // numbered decision twice in one message, we only broadcast it once.
  const seenVerdictIds = new Set<number>();
  for (const match of text.matchAll(VERDICT_RE)) {
    const idStr = match[1];
    const body = match[2]?.trim();
    if (!idStr || !body) continue;
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seenVerdictIds.has(id)) continue;
    seenVerdictIds.add(id);
    verdicts.push({ id, text: body });
  }

  const remainingText = text
    .replace(TASK_RE, '')
    .replace(SUMMON_RE, '')
    .replace(DISMISS_RE, '')
    .replace(VERDICT_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    tasks,
    summonedAgents: Array.from(summoned),
    dismissedAgents: Array.from(dismissed),
    verdicts,
    remainingText,
  };
}
