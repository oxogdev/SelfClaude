const TASK_RE = /<TASK_FOR_DEVELOPER>([\s\S]*?)<\/TASK_FOR_DEVELOPER>/g;

export interface TagExtractionResult {
  /** Trimmed task bodies extracted from the supervisor's text. Empty bodies are dropped. */
  tasks: string[];
  /** The supervisor's text with all task tags removed and runs of blank lines normalized. */
  remainingText: string;
}

/**
 * Parse a supervisor message and split it into:
 *   - one or more `<TASK_FOR_DEVELOPER>` blocks → developer-bound tasks
 *   - the residual narrative → user-bound chat
 *
 * Tags are non-greedy and case-sensitive. Empty/whitespace-only bodies are
 * silently discarded. The remaining text is whitespace-normalized so the
 * supervisor pane doesn't show two blank lines where a tag was removed.
 */
export function extractDeveloperTasks(text: string): TagExtractionResult {
  const tasks: string[] = [];
  for (const match of text.matchAll(TASK_RE)) {
    const inner = match[1]?.trim();
    if (inner) tasks.push(inner);
  }
  const remainingText = text.replace(TASK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { tasks, remainingText };
}
