import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

export function StatusBar() {
  const phase = useTuiStore((s) => s.phase);
  const fsmState = useTuiStore((s) => s.fsmState);
  const supActive = useTuiStore((s) => s.supervisorActive);
  const devActive = useTuiStore((s) => s.developerActive);
  const tg = useTuiStore((s) => s.telegramConnected);

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>SelfClaude</Text>
      <Text> │ phase: </Text>
      <Text color="cyan">{phase}</Text>
      <Text> │ state: </Text>
      <Text color="yellow">{fsmState.tag}</Text>
      <Text> │ sup </Text>
      <Text color={supActive ? 'green' : 'gray'}>{supActive ? '●' : '○'}</Text>
      <Text> │ dev </Text>
      <Text color={devActive ? 'green' : 'gray'}>{devActive ? '●' : '○'}</Text>
      <Text> │ tg </Text>
      <Text color={tg ? 'green' : 'gray'}>{tg ? '●' : '○'}</Text>
    </Box>
  );
}
