import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

export function StatusBar() {
  const phase = useTuiStore((s) => s.phase);
  const fsmState = useTuiStore((s) => s.fsmState);
  const supActive = useTuiStore((s) => s.supervisorActive);
  const devActive = useTuiStore((s) => s.developerActive);
  const tg = useTuiStore((s) => s.telegramConnected);
  const focusedPane = useTuiStore((s) => s.focusedPane);
  const turn = useTuiStore((s) => s.currentTurnIndex);

  return (
    <Box paddingX={1}>
      <Text bold>SelfClaude</Text>
      <Text> · phase </Text>
      <Text color="cyan">{phase}</Text>
      <Text> · </Text>
      <Text color="yellow">{fsmState.tag}</Text>
      <Text> · sup </Text>
      <Text color={supActive ? 'green' : 'gray'}>{supActive ? '●' : '○'}</Text>
      <Text> dev </Text>
      <Text color={devActive ? 'green' : 'gray'}>{devActive ? '●' : '○'}</Text>
      <Text> tg </Text>
      <Text color={tg ? 'green' : 'gray'}>{tg ? '●' : '○'}</Text>
      <Text> · turn {turn}</Text>
      <Text> · </Text>
      <Text color={focusedPane === 'dev' ? 'magenta' : 'gray'}>
        [{focusedPane === 'dev' ? 'dev' : 'input'} focused]
      </Text>
    </Box>
  );
}
