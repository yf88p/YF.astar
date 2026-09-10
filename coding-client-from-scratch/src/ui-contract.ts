import type { KilnEvent, Mode, Model, PermissionPrompt, SessionMeta, SessionRecord, Usage } from './types.js';

export interface ClientStatus {
  cwd: string;
  session: SessionMeta;
  model: Model;
  mode: Mode;
  thinking: string;
  running: boolean;
  queued: number;
  usage: Usage;
  contextTokens: number;
  git: string;
  extensions: string[];
}
export interface InteractiveClient {
  status(): ClientStatus;
  subscribe(listener: (event: KilnEvent) => void): () => void;
  submit(text: string, delivery?: 'steer' | 'follow-up'): Promise<void>;
  abort(): void;
  command(line: string): Promise<string>;
  commands(): { name: string; description: string }[];
  models(): { key: string; model: Model }[];
  sessions(query?: string): SessionMeta[];
  tree(): SessionRecord[];
  files(query?: string): Promise<string[]>;
  transcript(): { role: string; content: string }[];
  close(): Promise<void>;
}
export interface TerminalUI {
  prompt: PermissionPrompt;
  attach(client: InteractiveClient): void;
  notice(text: string): void;
  run(): Promise<void>;
  destroy(): void;
}
