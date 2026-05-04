import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

const KIND_COLOR = {
  user: 'magenta',
  supervisor: 'cyan',
  system: 'gray',
} as const;

const KIND_PREFIX = {
  user: '› ',
  supervisor: '◆ ',
  system: '· ',
} as const;

export function SupervisorPane() {
  const lines = useTuiStore((s) => s.supervisorChat);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      width="50%"
      paddingX={1}
      flexGrow={1}
    >
      <Text bold color="cyan">
        Supervisor
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.length === 0 ? (
          <Text dimColor>(no messages yet)</Text>
        ) : (
          lines.slice(-30).map((line) => (
            <Box key={line.ts} flexDirection="row">
              <Text color={KIND_COLOR[line.kind]}>{KIND_PREFIX[line.kind]}</Text>
              <Text>{line.text}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
