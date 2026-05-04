import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

export function QuestionPrompt() {
  const pq = useTuiStore((s) => s.pendingQuestion);
  const pa = useTuiStore((s) => s.pendingApproval);
  if (!pq && !pa) return null;

  if (pa) {
    return (
      <Box borderStyle="double" borderColor="red" paddingX={1} flexDirection="column">
        <Text bold color="red">
          Approval requested
        </Text>
        <Text>
          action: <Text bold>{pa.action}</Text>
        </Text>
        <Text dimColor>reason: {pa.reason}</Text>
      </Box>
    );
  }

  if (pq) {
    return (
      <Box borderStyle="double" borderColor="yellow" paddingX={1} flexDirection="column">
        <Text bold color="yellow">
          Supervisor asks
        </Text>
        <Text>{pq.text}</Text>
        {pq.options && pq.options.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {pq.options.map((o, i) => (
              <Text key={o}>
                {' '}
                [{i + 1}] {o}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    );
  }

  return null;
}
