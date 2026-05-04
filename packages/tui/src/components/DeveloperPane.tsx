import { Box, Text } from 'ink';
import { useTuiStore, type DevEvent, type DevEventKind } from '../store.js';

const PREFIX: Record<DevEventKind, string> = {
  'turn-marker': '── ',
  'task-marker': '🧭 ',
  tool: '⚙ ',
  'tool-result': '  ',
  text: '💬 ',
  system: '· ',
};

const COLOR: Record<DevEventKind, string | undefined> = {
  'turn-marker': 'gray',
  'task-marker': 'cyan',
  tool: 'blue',
  'tool-result': 'green',
  text: 'white',
  system: 'gray',
};

function summaryLine(evt: DevEvent): string {
  if (evt.kind === 'tool' && evt.toolResultText !== undefined) {
    const mark = evt.isError ? '✗' : '✓';
    const tail =
      evt.toolResultText.length > 60
        ? `${evt.toolResultText.slice(0, 57).replace(/\s+$/, '')}…`
        : evt.toolResultText.trim();
    return `${evt.summary}\n  ${mark} ${tail || (evt.isError ? 'error' : 'ok')}`;
  }
  return evt.summary;
}

/**
 * Selection-driven viewport: when the user navigates with j/k, the visible
 * window scrolls to keep the selected event visible. In auto-follow mode,
 * the latest event is selected and the window sticks to the tail.
 */
function computeViewport(
  total: number,
  innerHeight: number,
  selectedIdx: number | null,
  autoFollow: boolean,
): { start: number; end: number } {
  if (total === 0) return { start: 0, end: 0 };
  const cap = Math.max(1, innerHeight);
  if (autoFollow || selectedIdx === null || selectedIdx === -1) {
    const start = Math.max(0, total - cap);
    return { start, end: total };
  }
  // Center selected near the bottom 2/3 of the viewport.
  const desiredStart = Math.max(0, selectedIdx - Math.floor((cap * 2) / 3));
  const start = Math.min(desiredStart, Math.max(0, total - cap));
  return { start, end: Math.min(total, start + cap) };
}

export interface DeveloperPaneProps {
  width: number;
  height: number;
}

export function DeveloperPane({ width, height }: DeveloperPaneProps) {
  const events = useTuiStore((s) => s.developerEvents);
  const selectedId = useTuiStore((s) => s.selectedDevEventId);
  const autoFollow = useTuiStore((s) => s.autoFollow);
  const focused = useTuiStore((s) => s.focusedPane === 'dev');
  // Title (1) + bottom border slack (2). Accounting for tool events that
  // render as 2 lines is approximate — we under-show a bit rather than
  // overflow.
  const innerHeight = Math.max(1, height - 3);
  const selectedIdx = selectedId ? events.findIndex((e) => e.id === selectedId) : -1;
  const { start, end } = computeViewport(events.length, innerHeight, selectedIdx, autoFollow);
  const visible = events.slice(start, end);
  const more = start > 0 ? start : 0;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={focused ? 'magenta' : 'green'}
      paddingX={1}
      overflow="hidden"
    >
      <Box>
        <Text bold color={focused ? 'magenta' : 'green'}>
          Developer
        </Text>
        {focused ? (
          <Text dimColor> · j/k move · g/G top/bottom · Esc auto-follow · Tab back</Text>
        ) : null}
        {more > 0 ? <Text dimColor> · ↑ {more} earlier</Text> : null}
      </Box>
      {visible.length === 0 ? (
        <Text dimColor>(idle — no activity)</Text>
      ) : (
        visible.map((evt) => {
          const isSelected = selectedId === evt.id;
          const marker = isSelected ? '▶ ' : '  ';
          return (
            <Box key={evt.id} flexDirection="row">
              <Text color={isSelected ? 'magenta' : 'gray'}>{marker}</Text>
              <Text color={COLOR[evt.kind]} dimColor={evt.kind === 'system'}>
                {PREFIX[evt.kind]}
              </Text>
              <Box flexGrow={1}>
                <Text
                  color={isSelected ? 'white' : COLOR[evt.kind]}
                  dimColor={evt.kind === 'system' && !isSelected}
                  bold={isSelected}
                >
                  {summaryLine(evt)}
                </Text>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
