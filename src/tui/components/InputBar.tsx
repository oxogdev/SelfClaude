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
  const busy = (supActive || devActive) && !pendingQ && !pendingA;

  if (!isRawModeSupported) {
    return (
      <Box>
        <Text dimColor>(input disabled — stdin is not a TTY)</Text>
      </Box>
    );
  }

  if (busy) {
    return (
      <Box>
        <Text dimColor>working… (Ctrl+C to abort)</Text>
      </Box>
    );
  }

  const placeholder = pendingQ
    ? 'type answer ↵'
    : pendingA
      ? 'y to approve, n to deny ↵'
      : 'message supervisor ↵';

  const promptColor = pendingQ ? 'yellow' : pendingA ? 'red' : 'cyan';

  return (
    <Box>
      <Text color={promptColor}>▸ </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => {
          onSubmit(v);
          setValue('');
        }}
        placeholder={placeholder}
      />
    </Box>
  );
}
