import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

/**
 * Bottom drawer rendered immediately above the InputBar when a question or
 * approval is pending. Returns null otherwise so it occupies zero space.
 */
export function Drawer() {
  const pq = useTuiStore((s) => s.pendingQuestion);
  const pa = useTuiStore((s) => s.pendingApproval);
  if (!pq && !pa) return null;

  if (pa) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="red"
        paddingX={1}
      >
        <Text bold color="red">
          ⚠️ Approval requested
        </Text>
        <Text>
          <Text bold>action:</Text> {pa.action}
        </Text>
        <Text dimColor>reason: {pa.reason}</Text>
        <Text dimColor>type `y` to allow, anything else denies</Text>
      </Box>
    );
  }

  if (pq) {
    const opts = pq.options ?? [];
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        paddingX={1}
      >
        <Text bold color="yellow">
          ❓ Supervisor asks
        </Text>
        <Text>{pq.text}</Text>
        {opts.length > 0 ? (
          <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
            {opts.map((o, i) => (
              <Box key={o} marginRight={2}>
                <Text color="yellow" bold>
                  [{i + 1}]
                </Text>
                <Text> {o}</Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {opts.length > 0 ? (
          <Text dimColor>type a number for the option, or write a custom answer</Text>
        ) : (
          <Text dimColor>type your answer below</Text>
        )}
      </Box>
    );
  }

  return null;
}
