import { Box, useApp, useInput, useStdin } from 'ink';
import { StatusBar } from './components/StatusBar.js';
import { SupervisorPane } from './components/SupervisorPane.js';
import { DeveloperPane } from './components/DeveloperPane.js';
import { InputBar } from './components/InputBar.js';
import { QuestionPrompt } from './components/QuestionPrompt.js';

export interface AppProps {
  onUserInput: (text: string) => void;
  onExit?: () => void;
}

/**
 * Mounts the Ctrl+C handler. Isolated in its own component so we can
 * conditionally mount it only when raw mode is supported — `useInput`
 * unconditionally calls `setRawMode` even with `isActive: false`, so
 * gating must happen at the React tree level rather than via the option.
 */
function ExitOnCtrlC({ onExit }: { onExit?: () => void }) {
  const app = useApp();
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onExit?.();
      app.exit();
    }
  });
  return null;
}

export function App({ onUserInput, onExit }: AppProps) {
  const { isRawModeSupported } = useStdin();
  return (
    <Box flexDirection="column">
      {isRawModeSupported ? <ExitOnCtrlC onExit={onExit} /> : null}
      <StatusBar />
      <Box flexDirection="row">
        <SupervisorPane />
        <DeveloperPane />
      </Box>
      <QuestionPrompt />
      <InputBar onSubmit={onUserInput} />
    </Box>
  );
}
