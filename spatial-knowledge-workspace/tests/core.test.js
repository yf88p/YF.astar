import test from 'node:test';
import assert from 'node:assert/strict';
import {
  id, blankWorkspace, change, editBlock, renameDocument, splitBlock, mergeBlocks,
  deleteBlock, restoreBlock, setDocumentStatus, resolvePlacement, search, backlinks,
  parseMarkdown, exportMarkdown, safeUrl, validateWorkspace, exportPackage,
  WorkspaceStore, History, screenToWorld, zoomAt, fitCamera,
} from '../src/core.js';

const timestamp = '2026-09-06T12:00:00.000Z';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTQAAAABJRU5ErkJggg==';

function fixture() {
  return {
    version: 1, id: 'workspace-one', name: 'Research', createdAt: timestamp,
    documents: [
      {
        id: 'doc-one', title: 'Garden research', summary: '', tags: ['botany'],
        blocks: [
          { id: 'block-one', type: 'paragraph', text: 'Seeds grow slowly.' },
          { id: 'block-two', type: 'checklist', text: 'Water daily', checked: false },
          { id: 'block-three', type: 'paragraph', text: 'Keep warm.' },
        ],
        deletedBlocks: [], status: 'active', provenance: { type: 'local' }, createdAt: timestamp, updatedAt: timestamp,
      },
      {
        id: 'doc-two', title: 'Observations', summary: '', tags: ['journal'],
        blocks: [
          { id: 'block-link', type: 'link', text: 'Seed reference', target: { documentId: 'doc-one', blockId: 'block-two' } },
          { id: 'block-plain', type: 'paragraph', text: 'doc-one is not itself a link' },
        ],
        deletedBlocks: [], status: 'active', provenance: null, createdAt: timestamp, updatedAt: timestamp,
      },
    ],
    boards: [{
      id: 'board-one', name: 'Synthesis', description: '', camera: { x: 0, y: 0, zoom: 1 },
      placements: [
        { id: 'place-one', kind: 'document', documentId: 'doc-one', x: 0, y: 0, w: 300, h: 200 },
        { id: 'place-two', kind: 'excerpt', documentId: 'doc-one', blockIds: ['block-two'], x: 400, y: 0, w: 200, h: 100 },
      ],
      frames: [{ id: 'frame-one', title: 'Ideas', x: -20, y: -20, w: 700, h: 300, color: '#abc' }],
      relationships: [{ id: 'rel-one', from: 'place-one', to: 'place-two', type: 'supports', label: 'Evidence', directed: true }],
    }],
    assets: [],
  };
}

class MemoryStorage {
  data = new Map();
  writes = [];
  fail = () => false;
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) {
    this.writes.push(['set', key]);
    if (this.fail('set', key, value)) throw new Error('QuotaExceededError');
    this.data.set(key, String(value));
  }
  removeItem(key) {
    this.writes.push(['remove', key]);
    if (this.fail('remove', key)) throw new Error('Removal failed');
    this.data.delete(key);
  }
}

test('blank workspaces and IDs are independent valid values', () => {
  const first = blankWorkspace('First');
  const second = blankWorkspace('Second');
  assert.equal(validateWorkspace(first), first);
  assert.notEqual(first.id, second.id);
  first.documents.push({});
  assert.deepEqual(second.documents, []);
  assert.match(id(), /^id_/);
  assert.equal(new Set(Array.from({ length: 1000 }, () => id('block'))).size, 1000);
  assert.throws(() => id('../bad'), /prefix/);
  assert.throws(() => blankWorkspace(' '), /name/);
});

test('edits, rename and reorder preserve stored references and leave previous state untouched', () => {
  const original = fixture();
  const before = structuredClone(original);
  let next = editBlock(original, 'doc-one', 'block-two', { text: 'Water weekly', checked: true });
  next = renameDocument(next, 'doc-one', 'Seasonal garden');
  next = change(next, w => w.documents[0].blocks.reverse());
  assert.deepEqual(original, before);
  assert.equal(resolvePlacement(next, next.boards[0].placements[1]).blocks[0].text, 'Water weekly');
  assert.equal(resolvePlacement(next, next.boards[0].placements[1]).title, 'Seasonal garden');
  assert.equal(next.documents[0].blocks[1].id, 'block-two');
  assert.deepEqual(next.documents[1].blocks[0].target, before.documents[1].blocks[0].target);
  assert.equal(validateWorkspace(next), next);
  assert.throws(() => editBlock(next, 'doc-one', 'block-two', { id: 'replacement' }), /Cannot edit/);
  assert.throws(() => renameDocument(next, 'absent', 'x'), /not found/);
  assert.throws(() => change(original, w => { w.name = 'Changed'; throw new Error('abort'); }), /abort/);
  assert.deepEqual(original, before);
});

test('patch metadata is cloned and optional fields can be removed', () => {
  const target = { documentId: 'doc-two' };
  const next = editBlock(fixture(), 'doc-one', 'block-one', { target });
  target.documentId = 'missing';
  assert.equal(next.documents[0].blocks[0].target.documentId, 'doc-two');
  const cleared = editBlock(next, 'doc-one', 'block-one', { target: undefined });
  assert.equal(Object.hasOwn(cleared.documents[0].blocks[0], 'target'), false);
  validateWorkspace(cleared);
  assert.throws(() => editBlock(next, 'doc-one', 'block-one', { text: undefined }), /Block text/);
  assert.throws(() => editBlock(next, 'doc-one', 'block-one', { type: 'html' }), /block type/);
  assert.throws(() => editBlock(next, 'doc-one', 'block-one', { checked: 1 }), /boolean/);
  assert.throws(() => editBlock(next, 'doc-one', 'block-one', { url: 'javascript:alert(1)' }), /safe absolute/);
});

test('split retains the first ID, creates a distinct second ID, and exact merge tombstones it', () => {
  const original = fixture();
  const split = splitBlock(original, 'doc-one', 'block-one', 6);
  const [first, second] = split.documents[0].blocks;
  assert.equal(first.id, 'block-one');
  assert.equal(first.text, 'Seeds ');
  assert.equal(second.text, 'grow slowly.');
  assert.notEqual(second.id, first.id);
  const withReference = change(split, w => { w.boards[0].placements[1].blockIds = [second.id]; });
  const merged = mergeBlocks(withReference, 'doc-one', first.id, second.id);
  assert.equal(merged.documents[0].blocks[0].text, original.documents[0].blocks[0].text);
  assert.deepEqual(merged.documents[0].deletedBlocks[0], { ...second, originalIndex: 1 });
  assert.equal(resolvePlacement(merged, merged.boards[0].placements[1]).state, 'missing');
  assert.deepEqual(merged.boards[0].placements[1].blockIds, [second.id]);
  validateWorkspace(merged);
  assert.throws(() => splitBlock(original, 'doc-one', 'block-one', -1), /offset/);
  assert.throws(() => splitBlock(original, 'doc-one', 'block-one', 100), /offset/);
  assert.throws(() => splitBlock(original, 'doc-one', 'block-one', 0.5), /offset/);
  assert.throws(() => mergeBlocks(original, 'doc-one', 'block-one', 'block-one'), /itself/);
  for (const offset of [0, original.documents[0].blocks[0].text.length]) validateWorkspace(splitBlock(original, 'doc-one', 'block-one', offset));
});

test('delete and merge keep full tombstones; restore revives original references without retargeting', () => {
  const original = fixture();
  const deleted = deleteBlock(original, 'doc-one', 'block-two');
  const placement = deleted.boards[0].placements[1];
  assert.deepEqual(deleted.documents[0].deletedBlocks, [{ ...original.documents[0].blocks[1], originalIndex: 1 }]);
  assert.deepEqual(resolvePlacement(deleted, placement).missingIds, ['block-two']);
  assert.equal(resolvePlacement(deleted, placement).state, 'missing');
  assert.deepEqual(resolvePlacement(deleted, placement).blocks, []);
  assert.equal(backlinks(deleted, 'doc-one')[0].target.blockId, 'block-two');
  validateWorkspace(deleted);
  assert.throws(() => editBlock(deleted, 'doc-one', 'block-two', { text: 'wrong' }), /Live block not found/);
  const restored = restoreBlock(deleted, 'doc-one', 'block-two');
  assert.deepEqual(restored.documents[0].blocks, original.documents[0].blocks);
  assert.deepEqual(restored.documents[0].deletedBlocks, []);
  assert.equal(resolvePlacement(restored, placement).state, 'live');
  const merged = mergeBlocks(original, 'doc-one', 'block-one', 'block-two');
  assert.equal(resolvePlacement(merged, placement).state, 'missing');
  assert.equal(restoreBlock(merged, 'doc-one', 'block-two').documents[0].blocks[1].checked, false);
  assert.throws(() => restoreBlock(original, 'doc-one', 'block-two'), /Deleted block not found/);
});

test('restore clamps the saved original index after other content is removed', () => {
  let w = deleteBlock(fixture(), 'doc-one', 'block-three');
  w = deleteBlock(w, 'doc-one', 'block-one');
  w = restoreBlock(w, 'doc-one', 'block-three');
  assert.deepEqual(w.documents[0].blocks.map(block => block.id), ['block-two', 'block-three']);
  validateWorkspace(w);
});

test('partial excerpts are honestly missing and source status takes precedence', () => {
  const w = deleteBlock(fixture(), 'doc-one', 'block-two');
  const placement = { ...w.boards[0].placements[1], blockIds: ['block-one', 'block-two'] };
  const result = resolvePlacement(w, placement);
  assert.equal(result.state, 'missing');
  assert.deepEqual(result.blocks.map(block => block.id), ['block-one']);
  assert.deepEqual(result.missingIds, ['block-two']);
  const archived = setDocumentStatus(w, 'doc-one', 'archived');
  assert.equal(resolvePlacement(archived, placement).state, 'archived');
  const trashed = setDocumentStatus(w, 'doc-one', 'trashed');
  assert.equal(resolvePlacement(trashed, placement).state, 'trashed');
  assert.deepEqual(resolvePlacement(trashed, placement).blocks, []);
  validateWorkspace(trashed);
  assert.equal(resolvePlacement(w, { ...placement, documentId: 'absent' }).state, 'missing');
  assert.throws(() => setDocumentStatus(w, 'doc-one', 'deleted'), /Invalid document status/);
});

test('frozen snapshots and returned values stay isolated from later edits, rename, delete and trash', () => {
  const original = fixture();
  const frozen = {
    id: 'place-frozen', kind: 'frozen', documentId: 'doc-one', blockIds: ['block-two'],
    text: 'Captured watering plan', snapshot: [structuredClone(original.documents[0].blocks[1])],
    capturedAt: timestamp, x: 800, y: 0, w: 200, h: 200,
  };
  original.boards[0].placements.push(frozen);
  const before = resolvePlacement(original, frozen);
  let next = editBlock(original, 'doc-one', 'block-two', { text: 'Changed', checked: true });
  next = renameDocument(next, 'doc-one', 'Renamed');
  next = deleteBlock(next, 'doc-one', 'block-two');
  next = setDocumentStatus(next, 'doc-one', 'trashed');
  validateWorkspace(next);
  assert.deepEqual(resolvePlacement(next, next.boards[0].placements[2]), before);
  before.blocks[0].text = 'Mutating the result';
  assert.equal(frozen.snapshot[0].text, 'Water daily');
  assert.equal(resolvePlacement(blankWorkspace(), frozen).state, 'frozen');
});

test('multiple boards share live content but not placement geometry', () => {
  const original = fixture();
  original.boards.push({ id: 'board-two', name: 'Second', description: '', frames: [], relationships: [], camera: { x: 0, y: 0, zoom: 1 }, placements: [{ ...original.boards[0].placements[1], id: 'place-three', x: 900 }] });
  let next = editBlock(original, 'doc-one', 'block-two', { text: 'Shared update' });
  next = change(next, w => { w.boards[1].placements[0].x = 1200; });
  for (const placement of [next.boards[0].placements[1], next.boards[1].placements[0]]) assert.equal(resolvePlacement(next, placement).blocks[0].text, 'Shared update');
  assert.equal(next.boards[0].placements[1].x, 400);
  assert.equal(original.boards[1].placements[0].x, 900);
  const result = resolvePlacement(next, next.boards[0].placements[0]);
  result.blocks[0].text = 'Local copy';
  assert.equal(next.documents[0].blocks[0].text, 'Seeds grow slowly.');
  validateWorkspace(next);
});

test('search is fresh, deterministic, title/body weighted, filtered, active-only and workspace-isolated', () => {
  const original = fixture();
  assert.deepEqual(search(original, ''), []);
  assert.equal(search(original, 'water')[0].blockId, 'block-two');
  assert.equal(search(original, 'GARDEN water', { tag: 'BOTANY', type: 'checklist' }).length, 1);
  assert.deepEqual(search(original, 'water', { tag: 'journal' }), []);
  assert.deepEqual(search(original, 'water', { type: 'paragraph' }), []);
  let next = editBlock(original, 'doc-one', 'block-two', { text: 'Prune stems' });
  assert.deepEqual(search(next, 'water'), []);
  assert.equal(search(next, 'prune').length, 1);
  assert.equal(search(original, 'water').length, 1);
  assert.deepEqual(search(blankWorkspace('Other'), 'garden'), []);
  next = renameDocument(next, 'doc-one', 'Prune');
  assert.equal(search(next, 'prune')[0].blockId, 'block-two');
  const results = search(next, 'prune');
  const reordered = change(next, w => { w.documents.reverse(); w.documents.find(doc => doc.id === 'doc-one').blocks.reverse(); });
  assert.deepEqual(search(reordered, 'prune'), results);
  assert.deepEqual(search(setDocumentStatus(next, 'doc-one', 'archived'), 'prune'), []);
  assert.deepEqual(search(setDocumentStatus(next, 'doc-one', 'trashed'), 'prune'), []);
  assert.deepEqual(search(deleteBlock(original, 'doc-one', 'block-two'), 'water'), []);
});

test('backlinks report only live stored internal targets in active source documents', () => {
  const original = fixture();
  original.documents[1].blocks.push({ id: 'external-link', type: 'link', text: 'Garden research', url: 'https://example.com/doc-one' });
  assert.deepEqual(backlinks(original, 'doc-one').map(link => link.blockId), ['block-link']);
  assert.deepEqual(backlinks(setDocumentStatus(original, 'doc-two', 'archived'), 'doc-one'), []);
  assert.deepEqual(backlinks(setDocumentStatus(original, 'doc-two', 'trashed'), 'doc-one'), []);
  assert.deepEqual(backlinks(deleteBlock(original, 'doc-two', 'block-link'), 'doc-one'), []);
  const result = backlinks(original, 'doc-one');
  result[0].target.documentId = 'wrong';
  assert.equal(original.documents[1].blocks[0].target.documentId, 'doc-one');
});

test('Markdown imports editable blocks, provenance, safe media and inert HTML without execution', () => {
  const markdown = '# Field notes\r\n\r\n## Methods\n### Detail\n\nA paragraph\ncontinued.\n\n- Seed\n1. Soil\n- [ ] Water\n- [x] Observe\n\n> First\n> Second\n\n```js\n<script>globalThis.executed = true</script>\n```\n\n[Reference](https://example.com/path)\n\n![Leaf](https://example.com/leaf.png)\n\n[Unsafe](javascript:alert(1))\n\n<img src=x onerror=alert(1)>';
  const document = parseMarkdown(markdown, 'field.md');
  assert.equal(document.title, 'Field notes');
  assert.equal(document.provenance.filename, 'field.md');
  assert.equal(document.provenance.type, 'markdown');
  assert.equal(document.status, 'active');
  assert.deepEqual(document.blocks.map(block => block.type), ['heading1', 'heading2', 'heading3', 'paragraph', 'list', 'list', 'checklist', 'checklist', 'quote', 'code', 'link', 'image', 'paragraph', 'paragraph']);
  assert.equal(document.blocks[3].text, 'A paragraph\ncontinued.');
  assert.equal(document.blocks[6].checked, false);
  assert.equal(document.blocks[7].checked, true);
  assert.equal(document.blocks[8].text, 'First\nSecond');
  assert.match(document.blocks[9].text, /<script>/);
  assert.equal(globalThis.executed, undefined);
  assert.equal(document.blocks[12].url, undefined);
  assert.equal(new Set(document.blocks.map(block => block.id)).size, document.blocks.length);
  const w = blankWorkspace();
  w.documents.push(document);
  validateWorkspace(w);
  const changed = editBlock(w, document.id, document.blocks[3].id, { text: 'Edited paragraph' });
  assert.equal(changed.documents[0].blocks[3].id, document.blocks[3].id);
  assert.equal(parseMarkdown('', '/notes/Empty.md').title, 'Empty');
  assert.equal(parseMarkdown('~~~\nunclosed', 'code.md').blocks[0].text, 'unclosed');
  assert.equal(parseMarkdown('# C#\n\n## Section ##\n\n###', 'code.md').title, 'C#');
  assert.deepEqual(parseMarkdown('# C#\n\n## Section ##\n\n###').blocks.map(block => block.text), ['C#', 'Section', '']);
});

test('Markdown exports current content, safe links and raster assets, never deleted blocks', () => {
  const w = fixture();
  w.assets.push({ id: 'asset-one', name: 'Pixel', mime: 'image/png', data: png });
  w.documents[0].blocks.push(
    { id: 'block-image', type: 'image', text: 'Pixel', assetId: 'asset-one' },
    { id: 'block-code', type: 'code', text: '```\n<script>text</script>' },
    { id: 'block-html', type: 'paragraph', text: '<script>alert(1)</script> [bad](javascript:alert(1))' },
    { id: 'block-url', type: 'link', text: 'Safe', url: 'https://example.com/a(b)' },
  );
  const next = deleteBlock(editBlock(w, 'doc-one', 'block-two', { checked: true }), 'doc-one', 'block-three');
  const markdown = exportMarkdown(next, 'doc-one');
  assert.match(markdown, /^# Garden research/);
  assert.match(markdown, /- \[x\] Water daily/);
  assert.match(markdown, /!\[Pixel\]\(data:image\/png;base64,/);
  assert.match(markdown, /````\n```\n<script>text<\/script>\n````/);
  assert.ok(markdown.includes('\\<script\\>alert(1)\\</script\\> \\[bad\\]'));
  assert.match(markdown, /https:\/\/example.com\/a%28b%29/);
  assert.ok(!markdown.includes('Keep warm.'));
  assert.match(exportMarkdown(w, 'doc-two'), /#doc-one\/block-two/);
  assert.throws(() => exportMarkdown(w, 'absent'), /Document not found/);
});

test('URL policy rejects dangerous, relative, obfuscated and malformed destinations', () => {
  for (const url of ['https://example.com', 'http://example.com/a?b=1', 'mailto:hello@example.com', 'HTTPS://EXAMPLE.COM']) assert.equal(safeUrl(url), url);
  assert.equal(safeUrl(' https://example.com '), 'https://example.com');
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html;base64,AA==', 'data:image/png;base64,AA==', 'vbscript:x', 'file:///etc/passwd', '//example.com', '/relative', '#anchor', 'https:', 'http://', 'https:\\example.com', 'mailto:', 'mailto:a@example.com?body=%0d%0aX', 'https://exa mple.com', null]) assert.equal(safeUrl(url), '', String(url));
});

test('validation accepts tombstone refs, trashed refs and repeated copied snapshot IDs without mutation', () => {
  let w = deleteBlock(fixture(), 'doc-one', 'block-two');
  w = setDocumentStatus(w, 'doc-one', 'trashed');
  const copied = structuredClone(w.documents[0].blocks[0]);
  w.boards[0].placements.push({ id: 'frozen-one', kind: 'frozen', snapshot: [copied], capturedAt: timestamp, x: 0, y: 0, w: 100, h: 100 });
  w.boards[0].placements.push({ id: 'frozen-two', kind: 'frozen', snapshot: [structuredClone(copied)], x: 0, y: 0, w: 100, h: 100 });
  const before = structuredClone(w);
  assert.equal(validateWorkspace(w), w);
  assert.deepEqual(w, before);
  assert.deepEqual(JSON.parse(exportPackage(w)), w);
});

test('validation rejects malformed schemas, duplicate IDs, missing or cross-document refs and unsafe assets', async t => {
  const cases = [
    ['version', w => { w.version = 2; }, /version/],
    ['unknown field', w => { w.surprise = true; }, /unknown field/],
    ['missing required field', w => { delete w.documents[0].summary; }, /summary.*required/],
    ['duplicate global IDs', w => { w.boards[0].id = w.documents[0].id; }, /duplicate global ID/],
    ['duplicate deleted ID', w => { w.documents[0].deletedBlocks.push({ ...w.documents[0].blocks[0], originalIndex: 0 }); }, /duplicate global ID/],
    ['missing document', w => { w.boards[0].placements[0].documentId = 'absent'; }, /nonexistent document/],
    ['missing excerpt block', w => { w.boards[0].placements[1].blockIds = ['absent']; }, /nonexistent block/],
    ['wrong document for block', w => { w.boards[0].placements[1].blockIds = ['block-link']; }, /nonexistent block/],
    ['missing internal target', w => { w.documents[1].blocks[0].target.documentId = 'absent'; }, /nonexistent document/],
    ['wrong internal block', w => { w.documents[1].blocks[0].target.blockId = 'block-link'; }, /nonexistent block/],
    ['nonfinite geometry', w => { w.boards[0].placements[0].x = Infinity; }, /finite/],
    ['NaN zoom', w => { w.boards[0].camera.zoom = NaN; }, /finite/],
    ['zero zoom', w => { w.boards[0].camera.zoom = 0; }, /zoom/],
    ['negative width', w => { w.boards[0].placements[0].w = -1; }, /finite and between/],
    ['unbounded position', w => { w.boards[0].placements[0].y = 1e20; }, /finite and between/],
    ['bad block type', w => { w.documents[0].blocks[0].type = 'html'; }, /block type/],
    ['bad checked type', w => { w.documents[0].blocks[1].checked = 'true'; }, /boolean/],
    ['bad status', w => { w.documents[0].status = 'gone'; }, /status/],
    ['bad timestamp', w => { w.createdAt = 'yesterday'; }, /timestamp/],
    ['bad tombstone index', w => { w.documents[0].deletedBlocks.push({ id: 'deleted', type: 'paragraph', text: '', originalIndex: -1 }); }, /originalIndex/],
    ['unsafe block URL', w => { w.documents[1].blocks[0].url = 'javascript:alert(1)'; }, /safe absolute/],
    ['missing image asset', w => { w.documents[0].blocks.push({ id: 'image-block', type: 'image', text: '', assetId: 'absent' }); }, /nonexistent asset/],
    ['SVG asset', w => { w.assets.push({ id: 'svg', name: 'Unsafe', mime: 'image/svg+xml', data: 'data:image/svg+xml;base64,PHN2Zz4=' }); }, /raster/],
    ['fake PNG', w => { w.assets.push({ id: 'fake', name: 'Fake', mime: 'image/png', data: 'data:image/png;base64,PGh0bWw+' }); }, /signature/],
    ['mismatched MIME', w => { w.assets.push({ id: 'fake', name: 'Fake', mime: 'image/jpeg', data: png }); }, /matching.*MIME/],
    ['invalid base64', w => { w.assets.push({ id: 'fake', name: 'Fake', mime: 'image/png', data: 'data:image/png;base64,not@base64' }); }, /base64/],
    ['dangling endpoint', w => { w.boards[0].relationships[0].to = 'doc-one'; }, /same board/],
    ['cross-board endpoint', w => { w.boards.push({ id: 'other-board', name: 'Other', description: '', camera: { x: 0, y: 0, zoom: 1 }, frames: [], relationships: [], placements: [w.boards[0].placements.pop()] }); }, /same board/],
    ['missing frozen snapshot', w => { w.boards[0].placements[0].kind = 'frozen'; }, /snapshot/],
    ['empty excerpt', w => { w.boards[0].placements[1].blockIds = []; }, /at least one/],
    ['undefined', w => { w.documents[0].provenance = undefined; }, /JSON values/],
    ['non-JSON prototype', w => { w.documents[0].provenance = new Date(); }, /plain object/],
    ['sparse array', w => { w.documents[0].tags = Array(1); }, /sparse/],
  ];
  for (const [name, mutate, message] of cases) await t.test(name, () => {
    const w = fixture();
    mutate(w);
    assert.throws(() => validateWorkspace(w), message);
  });
});

test('validation enforces counts, text and package limits and rejects cyclic/accessor data', () => {
  const docs = fixture();
  docs.documents = Array(10001).fill(docs.documents[0]);
  assert.throws(() => validateWorkspace(docs), /at most 10000 entries/);
  const blocks = fixture();
  blocks.documents[0].blocks = Array(100001).fill({ id: 'b', type: 'paragraph', text: '' });
  assert.throws(() => validateWorkspace(blocks), /at most 100000 entries/);
  const placements = fixture();
  placements.boards[0].placements = Array(50001).fill(placements.boards[0].placements[0]);
  assert.throws(() => validateWorkspace(placements), /at most 50000 entries/);
  const text = fixture();
  text.documents[0].blocks[0].text = 'x'.repeat(1_000_001);
  assert.throws(() => validateWorkspace(text), /1000000 characters/);
  text.documents[0].blocks[0].text = 'x'.repeat(25 * 1024 * 1024);
  assert.throws(() => validateWorkspace(text), /package exceeds/);
  const cycle = fixture();
  cycle.documents[0].provenance = cycle;
  assert.throws(() => validateWorkspace(cycle), /cyclic/);
  const getter = fixture();
  Object.defineProperty(getter, 'name', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => validateWorkspace(getter), /plain JSON properties/);
});

test('raster assets and local image/note placements resolve safely', () => {
  const w = fixture();
  w.assets.push({ id: 'asset-one', name: 'Pixel', mime: 'image/png', data: png });
  const image = { id: 'image-place', kind: 'image', assetId: 'asset-one', x: 0, y: 0, w: 10, h: 10 };
  const note = { id: 'note-place', kind: 'note', text: '<b>plain text</b>', x: 0, y: 0, w: 100, h: 100 };
  w.boards[0].placements.push(image, note);
  validateWorkspace(w);
  assert.equal(resolvePlacement(w, image).state, 'live');
  assert.equal(resolvePlacement(w, image).blocks[0].assetId, 'asset-one');
  assert.equal(resolvePlacement(w, { ...image, assetId: 'missing' }).state, 'missing');
  assert.equal(resolvePlacement(w, note).blocks[0].text, '<b>plain text</b>');
});

test('asset validation checks the signatures of every permitted raster MIME', () => {
  for (const [mime, bytes] of [
    ['image/png', '\x89PNG\r\n\x1a\n'],
    ['image/jpeg', '\xff\xd8\xff\xe0'],
    ['image/gif', 'GIF89a'],
    ['image/webp', 'RIFF\x04\0\0\0WEBP'],
  ]) {
    const w = blankWorkspace();
    w.assets.push({ id: 'raster', name: 'Raster', mime, data: `data:${mime};base64,${btoa(bytes)}` });
    validateWorkspace(w);
    w.assets[0].data = `data:${mime};base64,${btoa('<script>not an image</script>')}`;
    assert.throws(() => validateWorkspace(w), /signature/);
  }
});

test('store persists isolated workspaces and metadata with workspace-first writes', () => {
  const storage = new MemoryStorage();
  storage.setItem('unrelated', 'untouched');
  const store = new WorkspaceStore(storage);
  assert.deepEqual(store.list(), []);
  assert.equal(store.load('missing'), null);
  const first = store.create('First');
  const second = store.create('Second');
  const changed = change(first, w => { w.name = 'Renamed'; });
  store.save(changed);
  const reloaded = new WorkspaceStore(storage);
  assert.equal(reloaded.load(first.id).name, 'Renamed');
  assert.equal(reloaded.load(second.id).name, 'Second');
  assert.deepEqual(reloaded.list().map(entry => entry.name), ['Renamed', 'Second']);
  assert.deepEqual(Object.keys(reloaded.list()[0]).sort(), ['id', 'name', 'updatedAt']);
  assert.equal(storage.getItem('unrelated'), 'untouched');
  assert.deepEqual(storage.writes.slice(-2), [['set', `margin:workspace:${first.id}`], ['set', 'margin:index']]);
  const loaded = reloaded.load(first.id);
  loaded.name = 'Unsaved';
  assert.equal(reloaded.load(first.id).name, 'Renamed');
  const entries = reloaded.list();
  entries[0].name = 'Unsaved index';
  assert.equal(reloaded.list()[0].name, 'Renamed');
});

test('workspace quota failure leaves prior workspace and index untouched', () => {
  const storage = new MemoryStorage();
  const store = new WorkspaceStore(storage);
  const w = store.create('Original');
  const before = new Map(storage.data);
  storage.fail = (operation, key) => operation === 'set' && key.startsWith('margin:workspace:');
  assert.throws(() => store.save({ ...w, name: 'Not saved' }), /QuotaExceededError/);
  assert.deepEqual(storage.data, before);
  assert.equal(store.load(w.id).name, 'Original');
});

test('index quota failure restores an existing workspace byte-for-byte', () => {
  const storage = new MemoryStorage();
  const store = new WorkspaceStore(storage);
  const w = store.create('Original');
  const before = new Map(storage.data);
  storage.fail = (operation, key) => operation === 'set' && key === 'margin:index';
  assert.throws(() => store.save({ ...w, name: 'Not saved' }), /rolled back/);
  assert.deepEqual(storage.data, before);
  assert.equal(store.load(w.id).name, 'Original');
});

test('index quota failure removes newly written workspaces and preserves existing index', () => {
  const storage = new MemoryStorage();
  const store = new WorkspaceStore(storage);
  store.create('Existing');
  const before = new Map(storage.data);
  storage.fail = (operation, key) => operation === 'set' && key === 'margin:index';
  const w = blankWorkspace('New');
  assert.throws(() => store.save(w), /rolled back/);
  assert.equal(store.load(w.id), null);
  assert.deepEqual(storage.data, before);
  const empty = new MemoryStorage();
  empty.fail = storage.fail;
  assert.throws(() => new WorkspaceStore(empty).create('Cannot create'), /rolled back/);
  assert.equal(empty.data.size, 0);
});

test('rollback failure is explicitly reported rather than pretending to save or restore', () => {
  const storage = new MemoryStorage();
  const store = new WorkspaceStore(storage);
  const w = store.create('Original');
  storage.fail = (operation, key, value) => key === 'margin:index' || (operation === 'set' && JSON.parse(value).name === 'Original');
  assert.throws(() => store.save({ ...w, name: 'Changed' }), error => error instanceof AggregateError && /rollback failed/.test(error.message) && error.errors.length === 2);
  assert.equal(store.load(w.id).name, 'Changed');
  assert.equal(store.list()[0].name, 'Original');
  const empty = new MemoryStorage();
  empty.fail = (operation, key) => key === 'margin:index' || operation === 'remove';
  assert.throws(() => new WorkspaceStore(empty).create('New'), /rollback failed/);
});

test('corrupt reads and invalid saves throw without replacing valid stored data', () => {
  const storage = new MemoryStorage();
  const store = new WorkspaceStore(storage);
  const w = fixture();
  store.save(w);
  const before = new Map(storage.data);
  assert.throws(() => store.save({ ...w, version: 99 }), /version/);
  assert.deepEqual(storage.data, before);
  storage.data.set('margin:index', '{broken');
  assert.throws(() => store.list(), /Corrupt workspace index/);
  assert.throws(() => store.save(w), /Corrupt workspace index/);
  assert.equal(storage.getItem(`margin:workspace:${w.id}`), before.get(`margin:workspace:${w.id}`));
  storage.data.set('margin:index', JSON.stringify([{ id: 'same', name: 'One', updatedAt: timestamp }, { id: 'same', name: 'Two', updatedAt: timestamp }]));
  assert.throws(() => store.list(), /duplicate/);
  storage.data.set(`margin:workspace:${w.id}`, '{broken');
  assert.throws(() => store.load(w.id), /Corrupt workspace/);
  storage.data.set(`margin:workspace:${w.id}`, JSON.stringify({ ...w, version: 2 }));
  assert.throws(() => store.load(w.id), /version/);
  storage.data.set(`margin:workspace:${w.id}`, JSON.stringify({ ...w, id: 'different' }));
  assert.throws(() => store.load(w.id), /does not match/);
});

test('history snapshots are cloned, bounded, independently scoped, and branching clears redo', () => {
  const boardHistory = new History(2);
  const documentHistory = new History();
  const first = { placements: [{ x: 0 }] };
  const second = { placements: [{ x: 10 }] };
  const third = { placements: [{ x: 20 }] };
  boardHistory.push(first);
  first.placements[0].x = 999;
  boardHistory.push(second);
  documentHistory.push({ text: 'Before' });
  const undone = boardHistory.undo(third);
  assert.deepEqual(undone, second);
  assert.equal(boardHistory.canRedo, true);
  assert.deepEqual(documentHistory.undo({ text: 'After' }), { text: 'Before' });
  undone.placements[0].x = 11;
  assert.deepEqual(boardHistory.redo(undone), third);
  assert.equal(boardHistory.undo(third).placements[0].x, 11);
  assert.equal(boardHistory.undo(second).placements[0].x, 0);
  assert.equal(boardHistory.canUndo, false);
  boardHistory.push(second);
  assert.equal(boardHistory.canRedo, false);
  boardHistory.push(third);
  boardHistory.push({ placements: [] });
  assert.equal(boardHistory.past.length, 2);
  boardHistory.clear();
  assert.equal(boardHistory.canUndo, false);
  assert.equal(boardHistory.canRedo, false);
  const unchanged = boardHistory.undo(first);
  assert.deepEqual(unchanged, first);
  assert.notEqual(unchanged, first);
  assert.deepEqual(boardHistory.redo(first), first);
  assert.throws(() => new History(0), /limit/);
});

test('screen transforms and cursor-anchored zoom are pure and numerically consistent', () => {
  const camera = { x: 120, y: -80, zoom: 2 };
  const point = { x: 500, y: 300 };
  const world = screenToWorld(point, camera);
  assert.deepEqual(world, { x: 190, y: 190 });
  for (const zoom of [0.05, 0.2, 1, 4, 8, 100]) {
    const next = zoomAt(camera, point, zoom);
    assert.deepEqual(screenToWorld(point, next), world);
    assert.ok(next.zoom >= 0.05 && next.zoom <= 8);
  }
  assert.deepEqual(camera, { x: 120, y: -80, zoom: 2 });
  assert.deepEqual(point, { x: 500, y: 300 });
  assert.throws(() => screenToWorld(point, { ...camera, zoom: 0 }), /zoom/);
  assert.throws(() => zoomAt(camera, point, NaN), /zoom/);
});

test('fit camera centers all bounds within padding and handles empty/narrow viewports', () => {
  const placements = [{ x: -200, y: -100, w: 100, h: 100 }, { x: 300, y: 200, w: 200, h: 100 }];
  const before = structuredClone(placements);
  const camera = fitCamera(placements, 1000, 800, 100);
  for (const item of placements) {
    assert.ok(item.x * camera.zoom + camera.x >= 100 - 1e-9);
    assert.ok(item.y * camera.zoom + camera.y >= 100 - 1e-9);
    assert.ok((item.x + item.w) * camera.zoom + camera.x <= 900 + 1e-9);
    assert.ok((item.y + item.h) * camera.zoom + camera.y <= 700 + 1e-9);
  }
  const center = screenToWorld({ x: 500, y: 400 }, camera);
  assert.ok(Math.abs(center.x - 150) < 1e-9 && Math.abs(center.y - 100) < 1e-9);
  assert.deepEqual(placements, before);
  assert.deepEqual(fitCamera([], 1000, 800), { x: 0, y: 0, zoom: 1 });
  const narrow = fitCamera(placements, 50, 50);
  assert.ok(Number.isFinite(narrow.x) && Number.isFinite(narrow.y) && narrow.zoom > 0);
  assert.throws(() => fitCamera([{ x: 0, y: 0, w: Infinity, h: 1 }], 100, 100), /finite/);
  assert.throws(() => fitCamera([], 0, 100), /Viewport/);
});
