export type Mode = 'plan' | 'build';
export type JsonSchema = Record<string, unknown>;
export type StopReason = 'stop' | 'length' | 'tool-use' | 'error' | 'aborted';
export interface Usage {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}
export interface Model {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  capabilities: { tools: boolean; images: boolean; reasoning: boolean };
  pricing?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}
export interface ToolCall { id: string; name: string; arguments: string }
export interface Attachment {
  path: string;
  mediaType: string;
  data: string;
  kind: 'text' | 'image';
}
export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  reasoning?: string;
  reasoningSignature?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  attachments?: Attachment[];
}
export interface ToolSpec { name: string; description: string; inputSchema: JsonSchema }
export interface ModelRequest {
  model: Model;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  thinking?: 'off' | 'low' | 'medium' | 'high';
  maxOutput?: number;
  signal: AbortSignal;
}
export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; signature?: string }
  | { type: 'tool'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'stop'; reason: StopReason };
export interface Provider { stream(request: ModelRequest): AsyncIterable<ProviderChunk> }
export interface ProviderConfig {
  type: 'anthropic' | 'openai';
  baseURL?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
}
export interface KilnEvent {
  version: 1;
  type: string;
  time: string;
  sessionId: string;
  [key: string]: unknown;
}
export type Emit = (type: string, data?: Record<string, unknown>) => void;
export interface Checkpoint {
  path: string;
  before: string | null;
  after: string | null;
  beforeHash: string | null;
  afterHash: string | null;
}
export interface PermissionRequest {
  id: string;
  tool: string;
  action: 'read' | 'write' | 'shell' | 'network' | 'extension' | 'secret';
  resource: string;
  reason: string;
  cwd: string;
  command?: string;
}
export type PermissionDecision = 'once' | 'session' | 'pattern' | 'deny';
export interface PermissionAnswer { decision: PermissionDecision; pattern?: string }
export type PermissionPrompt = (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionAnswer>;
export interface PermissionGate {
  authorize(request: Omit<PermissionRequest, 'id'>, signal: AbortSignal): Promise<void>;
  path(path: string, action: 'read' | 'write', tool: string, signal: AbortSignal): Promise<string>;
}
export interface ToolContext {
  cwd: string;
  stateDir: string;
  mode: Mode;
  signal: AbortSignal;
  emit: Emit;
  permissions: PermissionGate;
  checkpoint: (change: Checkpoint) => void;
  prepareCheckpoint?: (change: Checkpoint) => () => void;
  secrets?: string[];
  redact: (value: string) => string;
}
export interface ToolResult { content: string; isError?: boolean; metadata?: Record<string, unknown> }
export interface Tool extends ToolSpec {
  readonly: boolean;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
export interface SessionMeta {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  parentSession?: string;
  activeLeaf: string | null;
  labels: string[];
}
export interface SessionRecord {
  id: string;
  parentId: string | null;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}
export interface Session {
  meta: SessionMeta;
  append(type: string, data: Record<string, unknown>): SessionRecord;
  records(): SessionRecord[];
  branch(leaf: string | null): void;
  history(): Message[];
  rename(name: string): void;
  label(label: string): void;
  undo(): Promise<string>;
  redo(): Promise<string>;
  prepareCheckpoint?(change: Checkpoint): () => void;
  close(): void;
}
export interface ProcessServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
export interface LspConfig extends ProcessServerConfig { extensions: string[] }
export interface Config {
  model: string;
  models: Model[];
  aliases: Record<string, string>;
  enabledModels?: string[];
  providers: Record<string, ProviderConfig>;
  mode: Mode;
  thinking: 'off' | 'low' | 'medium' | 'high';
  maxTurns: number;
  retries: number;
  steering: 'steer' | 'follow-up';
  instructions?: string;
  templates: Record<string, string>;
  extensions: string[];
  servers: ProcessServerConfig[];
  lsp: LspConfig[];
  secrets: string[];
}
