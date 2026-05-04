import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

const KIND_COLOR = {
  text: 'white',
  tool: 'blue',
  'tool-result': 'green',
  system: 'gray',
} as const;

const KIND_ICON = {
  text: '· ',
  tool: '⚙ ',
  'tool-result': '✓ ',
  system: '· ',
} as const;

export function DeveloperPane() {
  const events = useTuiStore((s) => s.developerEvents);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      width="50%"
      paddingX={1}
      flexGrow={1}
    >
      <Text bold color="green">
        Developer
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {events.length === 0 ? (
          <Text dimColor>(idle — no activity)</Text>
        ) : (
          events.slice(-30).map((evt) => (
            <Box key={evt.ts} flexDirection="row">
              <Text color={KIND_COLOR[evt.kind]}>{KIND_ICON[evt.kind]}</Text>
              <Text>{evt.payload}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
