import { Box, Text } from 'ink';
import { useTuiStore, type ChatLineKind } from '../store.js';

const PREFIX: Record<ChatLineKind, string> = {
  user: '› ',
  supervisor: '◆ ',
  system: '· ',
  'task-tag': '🧭 ',
  'phase-doc': '📄 ',
};

const COLOR: Record<ChatLineKind, string> = {
  user: 'magenta',
  supervisor: 'cyan',
  system: 'gray',
  'task-tag': 'cyan',
  'phase-doc': 'green',
};

export interface SupervisorPaneProps {
  width: number;
  height: number;
}

export function SupervisorPane({ width, height }: SupervisorPaneProps) {
  const lines = useTuiStore((s) => s.supervisorChat);
  // Reserve 2 rows for top/bottom borders + 1 for title.
  const innerHeight = Math.max(1, height - 3);
  const visible = lines.slice(-innerHeight);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      overflow="hidden"
    >
      <Text bold color="cyan">
        Supervisor
      </Text>
      {visible.length === 0 ? (
        <Text dimColor>(no messages yet)</Text>
      ) : (
        visible.map((line) => (
          <Box key={line.ts} flexDirection="row">
            <Text color={COLOR[line.kind]} dimColor={line.kind === 'system'}>
              {PREFIX[line.kind]}
            </Text>
            <Box flexGrow={1}>
              <Text
                color={line.kind === 'task-tag' ? 'cyan' : undefined}
                dimColor={line.kind === 'system'}
                italic={line.kind === 'task-tag'}
              >
                {line.text}
              </Text>
            </Box>
          </Box>
        ))
      )}
    </Box>
  );
}
