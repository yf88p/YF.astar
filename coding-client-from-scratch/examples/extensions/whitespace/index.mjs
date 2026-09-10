import { readFile } from 'node:fs/promises';

export default function activate(api) {
  api.registerTool({
    name: 'audit',
    description: 'Report trailing whitespace, tabs, CRLF lines and a missing final newline without changing a file.',
    readonly: true,
    inputSchema: {
      type: 'object', properties: { path: { type: 'string', minLength: 1 } }, required: ['path'], additionalProperties: false,
    },
    async execute({ path }, context) {
      const allowed = await context.permissions.path(path, 'read', 'ext__whitespace__audit', context.signal);
      const text = await readFile(allowed, { encoding: 'utf8', signal: context.signal });
      const trailing = [], tabs = [], crlf = [];
      text.split('\n').forEach((line, index) => {
        if (/[ \t]+\r?$/.test(line)) trailing.push(index + 1);
        if (line.includes('\t')) tabs.push(index + 1);
        if (line.endsWith('\r')) crlf.push(index + 1);
      });
      return { content: JSON.stringify({ path, trailingWhitespaceLines: trailing, tabLines: tabs, crlfLines: crlf, missingFinalNewline: text.length > 0 && !text.endsWith('\n') }) };
    },
  });
}
