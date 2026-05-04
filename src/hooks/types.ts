import { z } from 'zod';

export const RoleSchema = z.enum(['supervisor', 'developer']);
export type Role = z.infer<typeof RoleSchema>;

const BaseHookPayload = z
  .object({
    session_id: z.string(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    permission_mode: z.string().optional(),
    hook_event_name: z.string(),
  })
  .passthrough();

export const StopHookPayloadSchema = BaseHookPayload.extend({
  hook_event_name: z.literal('Stop'),
});
export type StopHookPayload = z.infer<typeof StopHookPayloadSchema>;

export const PreToolUsePayloadSchema = BaseHookPayload.extend({
  hook_event_name: z.literal('PreToolUse'),
  tool_name: z.string(),
  tool_input: z.unknown(),
});
export type PreToolUsePayload = z.infer<typeof PreToolUsePayloadSchema>;

export const UserPromptSubmitPayloadSchema = BaseHookPayload.extend({
  hook_event_name: z.literal('UserPromptSubmit'),
  prompt: z.string().optional(),
  user_prompt: z.string().optional(),
});
export type UserPromptSubmitPayload = z.infer<typeof UserPromptSubmitPayloadSchema>;

export type PermissionDecision = 'ask' | 'allow' | 'deny';

export interface PreToolUseResponse {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: PermissionDecision;
    permissionDecisionReason?: string;
  };
}

export interface UserPromptSubmitResponse {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit';
    additionalContext: string;
  };
}
