import type { Message, PermissionAnswer, PermissionRequest, SessionMeta, Usage } from './types.js';

/** Version 1 built-in payloads. Extensions may emit additional namespaced event types. */
export interface EventPayloads {
  'session.start': { session: SessionMeta; ephemeral: boolean };
  'session.changed': { session: SessionMeta };
  'session.end': { session: SessionMeta };
  'agent.start': { model: string; mode: 'plan' | 'build' };
  'agent.end': { outcome: 'success' | 'failure' | 'aborted'; reason: string; turns: number; error?: string };
  'model.start': { model: string; attempt: number };
  'assistant.delta': { text: string };
  'reasoning.delta': { text: string };
  'assistant.end': { reason: 'stop' | 'tool-use'; text: string };
  'tool.arguments': { index: number; id: string; name: string; bytes: number };
  'tool.start': { id: string; name: string; arguments: string };
  'tool.progress': { id: string; name: string; text?: string; [key: string]: unknown };
  'tool.end': { id: string; name: string; content: string; isError: boolean; metadata?: Record<string, unknown> };
  'permission.request': { request: PermissionRequest; secret?: boolean };
  'permission.decision': PermissionAnswer & { requestId: string };
  'message.user': { text: string; attachments?: Omit<NonNullable<Message['attachments']>[number], 'data'>[] };
  'message.queued': { text: string; delivery: 'steer' | 'follow-up'; queued: number };
  'message.delivered': { count: number; queued: number; boundary: 'settled' | 'tool-batch' };
  'retry': { attempt: number; delayMs: number; error: string; contextOverflow?: boolean };
  'compaction.start': { automatic: boolean; beforeTokens: number };
  'compaction.end': { automatic: boolean; afterTokens: number; summary: string };
  'usage': { usage: Usage; total: Usage };
  'context': { tokens: number; window: number };
  'configuration': { model: string; thinking: string; mode: 'plan' | 'build' };
  'warning': { message: string };
  'error': { message: string };
  'notice': { message: string };
}
export type BuiltinEvent = {
  [Name in keyof EventPayloads]: { version: 1; type: Name; time: string; sessionId: string } & EventPayloads[Name]
}[keyof EventPayloads];
