import { useState } from 'react';
import { Box, Text, useStdin } from 'ink';
import TextInput from 'ink-text-input';
import { useTuiStore } from '../store.js';

export interface InputBarProps {
  onSubmit: (text: string) => void;
}

export function InputBar({ onSubmit }: InputBarProps) {
  const [value, setValue] = useState('');
  const { isRawModeSupported } = useStdin();
  const pendingQ = useTuiStore((s) => s.pendingQuestion);
  const pendingA = useTuiStore((s) => s.pendingApproval);
  const supActive = useTuiStore((s) => s.supervisorActive);
  const devActive = useTuiStore((s) => s.developerActive);
  const focusedPane = useTuiStore((s) => s.focusedPane);
  const busy = (supActive || devActive) && !pendingQ && !pendingA;

  if (!isRawModeSupported) {
    return (
      <Box>
        <Text dimColor>(input disabled — stdin is not a TTY)</Text>
      </Box>
    );
  }

  if (focusedPane === 'dev') {
    return (
      <Box>
        <Text color="magenta">⇡ </Text>
        <Text dimColor>dev pane focused — j/k move, Esc auto-follow, Tab back to input</Text>
      </Box>
    );
  }

  if (busy) {
    return (
      <Box>
        <Text dimColor>working… (Ctrl+C to abort, Tab to inspect dev timeline)</Text>
      </Box>
    );
  }

  const placeholder = pendingQ
    ? pendingQ.options && pendingQ.options.length > 0
      ? 'option number or free answer ↵'
      : 'type answer ↵'
    : pendingA
      ? 'y to approve, anything else denies ↵'
      : 'message supervisor ↵';

  const promptColor = pendingQ ? 'yellow' : pendingA ? 'red' : 'cyan';

  const handleSubmit = (raw: string) => {
    let resolved = raw;
    if (pendingQ?.options && pendingQ.options.length > 0) {
      const trimmed = raw.trim();
      if (/^[1-9]$/.test(trimmed)) {
        const idx = Number(trimmed) - 1;
        if (idx >= 0 && idx < pendingQ.options.length) {
          resolved = pendingQ.options[idx]!;
        }
      }
    }
    onSubmit(resolved);
    setValue('');
  };

  return (
    <Box>
      <Text color={promptColor}>▸ </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />
    </Box>
  );
}
