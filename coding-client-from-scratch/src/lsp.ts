import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Emit, LspConfig } from './types.js';
import { isRecord, ProcessRpc, RpcError } from './rpc.js';
import { checkAbort, errorMessage, KeyedQueue } from './util.js';

interface Document { text: string; version: number; languageId: string }
interface Server {
  config: LspConfig;
  status: 'ready' | 'unavailable' | 'starting';
  rpc?: ProcessRpc;
  documents: Map<string, Document>;
  diagnostics: Map<string, unknown[]>;
  formatting: boolean;
}
export interface LspTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}
export function matchesLanguage(config: LspConfig, path: string): boolean {
  return Array.isArray(config.extensions) && config.extensions.some(extension =>
    typeof extension === 'string' && /^\.?[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(extension) && path.toLowerCase().endsWith(extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`));
}

export class LspManager {
  private servers: Server[];
  private queue = new KeyedQueue();
  private closed = false;

  constructor(configs: LspConfig[], private cwd: string, private emit: Emit) {
    this.servers = configs.map(config => ({ config, status: 'unavailable', documents: new Map(), diagnostics: new Map(), formatting: false }));
  }

  async update(path: string, text: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    checkAbort(signal);
    if (this.closed) throw new Error('LSP manager is closed');
    const absolute = resolve(this.cwd, path);
    const uri = pathToFileURL(absolute).href;
    await Promise.all(this.servers.filter(server => this.matches(server, absolute)).map(server =>
      this.queue.run(String(this.servers.indexOf(server)), async () => {
        checkAbort(signal);
        if (this.closed) return;
        try {
          const previous = server.documents.get(uri);
          if (previous?.text === text && server.rpc?.alive && server.status === 'ready') return;
          const suffix = extname(absolute).slice(1).toLowerCase();
          const languages: Record<string, string> = { ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', py: 'python', rs: 'rust', sh: 'shellscript', cs: 'csharp', h: 'c', cc: 'cpp' };
          const document: Document = { text, version: (previous?.version ?? 0) + 1, languageId: languages[suffix] ?? suffix };
          server.documents.set(uri, document);
          server.diagnostics.delete(uri);
          // Reopen the latest buffers, not the stale text that may have crashed the previous process.
          if (!server.rpc?.alive || server.status !== 'ready') await this.start(server, signal);
          else if (previous) server.rpc.notify('textDocument/didChange', { textDocument: { uri, version: document.version }, contentChanges: [{ text }] });
          else server.rpc!.notify('textDocument/didOpen', { textDocument: { uri, ...document } });
          checkAbort(signal);
        } catch (error) {
          server.rpc?.fail(new Error(errorMessage(error)));
          this.unavailable(server, error);
          checkAbort(signal);
        }
      }),
    ));
  }

  diagnostics(): { server: string; status: 'ready' | 'unavailable' | 'starting'; diagnostics: unknown[] }[] {
    return this.servers.map(server => ({ server: server.config.name, status: server.status, diagnostics: structuredClone([...server.diagnostics.values()].flat()) }));
  }

  /** Returns edits, never writes files. Call update first to supply the current buffer. */
  async format(path: string, signal: AbortSignal = new AbortController().signal): Promise<LspTextEdit[]> {
    checkAbort(signal);
    if (this.closed) throw new Error('LSP manager is closed');
    const absolute = resolve(this.cwd, path);
    const uri = pathToFileURL(absolute).href;
    const matching = this.servers.filter(server => this.matches(server, absolute));
    if (!matching.length) throw new Error('No LSP server configured for this document');
    if (!matching.some(server => server.status === 'ready')) throw new Error('LSP is unavailable for this document; call update to start or retry');
    const server = matching.find(server => server.status === 'ready' && server.documents.has(uri) && server.formatting);
    if (!server) throw new Error('No ready formatting server for this document; call update first');
    const result = await server.rpc!.request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } }, signal);
    if (result === null) return [];
    const position = (value: unknown): boolean => isRecord(value) && Number.isInteger(value.line) && Number(value.line) >= 0 && Number.isInteger(value.character) && Number(value.character) >= 0;
    if (!Array.isArray(result) || result.some(edit => !isRecord(edit) || typeof edit.newText !== 'string' || !isRecord(edit.range) || !position(edit.range.start) || !position(edit.range.end))) {
      const error = new Error('Invalid LSP formatting edits');
      server.rpc!.fail(error);
      throw error;
    }
    return result as LspTextEdit[];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(this.servers.map(async server => {
      const rpc = server.rpc;
      if (!rpc) return;
      try {
        if (rpc.alive && server.status === 'ready') {
          await rpc.request('shutdown', null, AbortSignal.timeout(500));
          rpc.notify('exit');
        }
      } catch { /* Unresponsive servers are terminated below. */ }
      await rpc.close(250);
      server.status = 'unavailable';
      server.diagnostics.clear();
    }));
  }

  private matches(server: Server, path: string): boolean {
    return matchesLanguage(server.config, path);
  }

  private unavailable(server: Server, error: unknown): void {
    const changed = server.status !== 'unavailable';
    server.status = 'unavailable';
    server.formatting = false;
    server.diagnostics.clear();
    if (changed && !this.closed) {
      try { this.emit('lsp.status', { server: server.config.name, status: server.status, error: errorMessage(error) }); } catch { /* Isolate reporting failures. */ }
    }
  }

  private async start(server: Server, signal: AbortSignal): Promise<void> {
    server.status = 'starting';
    this.emit('lsp.status', { server: server.config.name, status: 'starting' });
    const rootUri = pathToFileURL(resolve(this.cwd)).href;
    const folders = [{ uri: rootUri, name: basename(resolve(this.cwd)) }];
    const rpc = new ProcessRpc(server.config, this.cwd, {
      framing: 'lsp',
      failure: error => { if (server.rpc === rpc) this.unavailable(server, error); },
      stderr: bytes => this.emit('lsp.stderr', { server: server.config.name, bytes }),
      notification: (method, params) => {
        if (method !== 'textDocument/publishDiagnostics') return;
        if (!isRecord(params) || typeof params.uri !== 'string' || !Array.isArray(params.diagnostics) || params.diagnostics.some(value => !isRecord(value))) {
          throw new Error('Invalid publishDiagnostics notification');
        }
        const document = server.documents.get(params.uri);
        if (typeof params.version === 'number' && document && params.version < document.version) return;
        const diagnostics = params.diagnostics.map(value => ({ ...value, uri: params.uri }));
        server.diagnostics.set(params.uri, diagnostics);
        this.emit('lsp.diagnostics', { server: server.config.name, uri: params.uri, diagnostics });
      },
      request: (method, params) => {
        if (method === 'workspace/configuration') return isRecord(params) && Array.isArray(params.items) ? params.items.map(() => null) : [];
        if (method === 'workspace/workspaceFolders') return folders;
        if (method === 'workspace/applyEdit') return { applied: false, failureReason: 'Kiln never applies server-initiated edits' };
        if (['client/registerCapability', 'client/unregisterCapability', 'window/workDoneProgress/create'].includes(method)) return null;
        throw new RpcError(`Unsupported client method: ${method}`, -32601);
      },
    });
    server.rpc = rpc;
    const result = await rpc.request('initialize', {
      processId: process.pid, clientInfo: { name: 'kiln', version: '0.1.0' }, rootUri, workspaceFolders: folders,
      capabilities: { workspace: { applyEdit: false, configuration: true, workspaceFolders: true }, textDocument: {
        synchronization: { dynamicRegistration: false }, publishDiagnostics: { relatedInformation: true }, formatting: { dynamicRegistration: false },
      } },
    }, signal);
    if (!isRecord(result) || !isRecord(result.capabilities)) throw new Error('Invalid LSP initialize result');
    rpc.notify('initialized', {});
    for (const [uri, document] of server.documents) rpc.notify('textDocument/didOpen', { textDocument: { uri, ...document } });
    server.formatting = result.capabilities.documentFormattingProvider === true || isRecord(result.capabilities.documentFormattingProvider);
    server.status = 'ready';
    this.emit('lsp.status', { server: server.config.name, status: 'ready' });
  }
}
