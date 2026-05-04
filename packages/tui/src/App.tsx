import { useEffect } from 'react';
import { Box, useApp, useInput, useStdin, useStdout } from 'ink';
import { StatusBar } from './components/StatusBar.js';
import { SupervisorPane } from './components/SupervisorPane.js';
import { DeveloperPane } from './components/DeveloperPane.js';
import { DetailPane } from './components/DetailPane.js';
import { Drawer } from './components/Drawer.js';
import { InputBar } from './components/InputBar.js';
import { useTuiStore } from './store.js';

export interface AppProps {
  onUserInput: (text: string) => void;
  onExit?: () => void;
}

/**
 * Mounts the global keyboard handler. Isolated in its own component so we
 * can conditionally mount it only when raw mode is supported — `useInput`
 * unconditionally calls `setRawMode` even with `isActive: false`.
 */
function Keyboard({ onExit }: { onExit?: () => void }) {
  const app = useApp();
  const focusedPane = useTuiStore((s) => s.focusedPane);
  const setFocus = useTuiStore((s) => s.setFocus);
  const selectPrev = useTuiStore((s) => s.selectPrevDevEvent);
  const selectNext = useTuiStore((s) => s.selectNextDevEvent);
  const selectFirst = useTuiStore((s) => s.selectFirstDevEvent);
  const selectLast = useTuiStore((s) => s.selectLastDevEvent);
  const enableAutoFollow = useTuiStore((s) => s.enableAutoFollow);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onExit?.();
      app.exit();
      return;
    }
    if (key.tab) {
      setFocus(focusedPane === 'dev' ? 'input' : 'dev');
      return;
    }
    if (focusedPane !== 'dev') return;
    if (key.escape) {
      enableAutoFollow();
      setFocus('input');
      return;
    }
    if (input === 'j' || key.downArrow) {
      selectNext();
      return;
    }
    if (input === 'k' || key.upArrow) {
      selectPrev();
      return;
    }
    if (input === 'g') {
      selectFirst();
      return;
    }
    if (input === 'G') {
      selectLast();
      return;
    }
  });
  return null;
}

function useTerminalSize(): void {
  const { stdout } = useStdout();
  const setTerminalSize = useTuiStore((s) => s.setTerminalSize);
  useEffect(() => {
    const update = () => {
      setTerminalSize({
        cols: stdout.columns ?? 100,
        rows: stdout.rows ?? 30,
      });
    };
    update();
    stdout.on('resize', update);
    return () => {
      stdout.off('resize', update);
    };
  }, [stdout, setTerminalSize]);
}

/**
 * Compute width allocations. Hides the detail pane on narrow terminals
 * (<100 cols), giving its share to the developer pane.
 */
function paneWidths(cols: number): { sup: number; dev: number; detail: number } {
  if (cols < 100) {
    const half = Math.floor(cols / 2);
    return { sup: half, dev: cols - half, detail: 0 };
  }
  const sup = Math.floor(cols * 0.3);
  const detail = Math.floor(cols * 0.25);
  const dev = cols - sup - detail;
  return { sup, dev, detail };
}

export function App({ onUserInput, onExit }: AppProps) {
  const { isRawModeSupported } = useStdin();
  useTerminalSize();
  const { cols, rows } = useTuiStore((s) => s.terminalSize);
  // Reserve 1 row at the bottom so the terminal doesn't push our last row
  // off-screen on the cursor line.
  const totalRows = Math.max(8, rows - 1);
  const statusH = 1;
  const inputH = 1;
  // Drawer is variable height; we reserve 0 unless something is pending.
  const pendingQ = useTuiStore((s) => s.pendingQuestion);
  const pendingA = useTuiStore((s) => s.pendingApproval);
  const drawerH = pendingQ ? Math.min(8, 4 + (pendingQ.options?.length ? 2 : 0)) : pendingA ? 5 : 0;
  const mainH = Math.max(3, totalRows - statusH - inputH - drawerH);

  const widths = paneWidths(cols);

  return (
    <Box flexDirection="column" width={cols} height={totalRows}>
      {isRawModeSupported ? <Keyboard onExit={onExit} /> : null}
      <Box height={statusH}>
        <StatusBar />
      </Box>
      <Box flexDirection="row" height={mainH}>
        <SupervisorPane width={widths.sup} height={mainH} />
        <DeveloperPane width={widths.dev} height={mainH} />
        {widths.detail > 0 ? <DetailPane width={widths.detail} height={mainH} /> : null}
      </Box>
      {drawerH > 0 ? (
        <Box height={drawerH}>
          <Drawer />
        </Box>
      ) : null}
      <Box height={inputH}>
        <InputBar onSubmit={onUserInput} />
      </Box>
    </Box>
  );
}
