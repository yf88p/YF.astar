export default function activate(api) {
  api.registerTemplate('changes', [
    'Review the current changes. Do not edit files.',
    'Prioritize correctness, permission boundaries, regressions and missing tests.',
    'Report actionable findings in severity order with file and line references.',
    'If there are no findings, say so and identify remaining verification gaps.',
  ].join('\n'));
  api.registerCommand('checklist', async args => [
    `Review checklist${args.trim() ? ` for ${args.trim()}` : ''}:`,
    '- Read the diff and surrounding code.',
    '- Trace untrusted inputs and permission checks.',
    '- Check cancellation, failure recovery and cleanup.',
    '- Run focused tests and report any unverified behavior.',
  ].join('\n'));
  api.registerStatus(() => 'Review checklist available');
}
