import { Box, Text } from 'ink';
import { useTuiStore, type DevEvent } from '../store.js';

function selectedEvent(): DevEvent | null {
  const s = useTuiStore.getState();
  if (!s.selectedDevEventId) return null;
  return s.developerEvents.find((e) => e.id === s.selectedDevEventId) ?? null;
}

function formatInput(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return '(no input)';
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return '(unserializable)';
  }
}

function tail(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const omitted = lines.length - maxLines;
  return `(…+${omitted} earlier line${omitted === 1 ? '' : 's'})\n${lines.slice(-maxLines).join('\n')}`;
}

export interface DetailPaneProps {
  width: number;
  height: number;
}

export function DetailPane({ width, height }: DetailPaneProps) {
  // useTuiStore is invoked outside of selectors here so we re-render when any
  // of these change — fine for a small detail panel.
  const selectedId = useTuiStore((s) => s.selectedDevEventId);
  const events = useTuiStore((s) => s.developerEvents);
  const focused = useTuiStore((s) => s.focusedPane === 'dev');
  const evt = selectedId ? events.find((e) => e.id === selectedId) ?? null : null;
  void selectedEvent; // keep helper exported for potential reuse

  const innerHeight = Math.max(1, height - 3);
  const tailLines = Math.max(3, innerHeight - 8);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      overflow="hidden"
    >
      <Text bold>Detail</Text>
      {!evt ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>No event selected.</Text>
          <Text dimColor>Tab — focus dev pane</Text>
          <Text dimColor>j/k — move selection</Text>
          <Text dimColor>g/G — top / bottom</Text>
          <Text dimColor>Esc — auto-follow latest</Text>
          <Text dimColor>Tab again — back to input</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text bold color={evt.kind === 'tool' ? 'blue' : 'white'}>
              {evt.toolName ?? evt.kind}
            </Text>
            {focused ? <Text dimColor> · selected</Text> : null}
          </Text>
          {evt.kind === 'tool' && evt.toolInput ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>input</Text>
              <Text>{tail(formatInput(evt.toolInput), Math.max(3, Math.floor(tailLines / 2)))}</Text>
            </Box>
          ) : null}
          {evt.toolResultText !== undefined ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={evt.isError ? 'red' : 'green'}>
                {evt.isError ? '✗ result (error)' : '✓ result'}
              </Text>
              <Text>{tail(evt.toolResultText.trim() || '(empty)', tailLines)}</Text>
            </Box>
          ) : evt.kind === 'tool' ? (
            <Box marginTop={1}>
              <Text dimColor>(awaiting result…)</Text>
            </Box>
          ) : null}
          {evt.kind !== 'tool' ? (
            <Box flexDirection="column" marginTop={1}>
              <Text>{evt.summary}</Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
