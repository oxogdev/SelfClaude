import { z } from 'zod';

export const AskUserArgsSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  urgency: z.enum(['low', 'high']).default('low'),
});
export type AskUserArgs = z.infer<typeof AskUserArgsSchema>;

export const AskUserHttpRequestSchema = AskUserArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
});
export type AskUserHttpRequest = z.infer<typeof AskUserHttpRequestSchema>;

export const AskUserHttpResponseSchema = z.object({
  answer: z.string(),
});
export type AskUserHttpResponse = z.infer<typeof AskUserHttpResponseSchema>;

export const RequestApprovalArgsSchema = z.object({
  action: z.string().min(1),
  reason: z.string().min(1),
});
export type RequestApprovalArgs = z.infer<typeof RequestApprovalArgsSchema>;

export const RequestApprovalHttpRequestSchema = RequestApprovalArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
});
export type RequestApprovalHttpRequest = z.infer<typeof RequestApprovalHttpRequestSchema>;

export const RequestApprovalHttpResponseSchema = z.object({
  decision: z.enum(['allow', 'deny']),
});
export type RequestApprovalHttpResponse = z.infer<typeof RequestApprovalHttpResponseSchema>;

export const WritePhaseDocArgsSchema = z.object({
  filename: z
    .string()
    .regex(/^[\w][\w-]*\.md$/, 'filename must look like "00-overview.md" (slug + .md)'),
  content: z.string().min(1),
});
export type WritePhaseDocArgs = z.infer<typeof WritePhaseDocArgsSchema>;

export const WritePhaseDocHttpRequestSchema = WritePhaseDocArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
});
export type WritePhaseDocHttpRequest = z.infer<typeof WritePhaseDocHttpRequestSchema>;

export const WritePhaseDocHttpResponseSchema = z.object({
  path: z.string(),
});
export type WritePhaseDocHttpResponse = z.infer<typeof WritePhaseDocHttpResponseSchema>;
