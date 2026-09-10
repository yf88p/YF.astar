const BLOCK_TYPES = new Set(['heading1', 'heading2', 'heading3', 'paragraph', 'list', 'checklist', 'quote', 'code', 'link', 'image']);
const STATUSES = new Set(['active', 'archived', 'trashed']);
const PLACEMENT_TYPES = new Set(['document', 'excerpt', 'frozen', 'note', 'image']);
const MAX_PACKAGE = 25 * 1024 * 1024;
const MAX_TEXT = 1_000_000;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const INDEX_KEY = 'margin:index';
let sequence = 0;

const clone = value => structuredClone(value);
const now = () => new Date().toISOString();

export function id(prefix = 'id') {
  if (typeof prefix !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(prefix)) {
    throw new Error('ID prefix must be 1-41 letters, digits, underscores or hyphens, starting with a letter');
  }
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${suffix}`;
}

export function blankWorkspace(name = 'Untitled workspace') {
  if (typeof name !== 'string' || !name.trim() || name.length > 1000) throw new Error('Workspace name must contain 1-1000 characters');
  return { version: 1, id: id('workspace'), name: name.trim(), documents: [], boards: [], assets: [], createdAt: now() };
}

export function change(workspace, mutator) {
  const next = clone(workspace);
  mutator(next);
  return next;
}

function documentById(w, docId) {
  const document = w.documents.find(doc => doc.id === docId);
  if (!document) throw new Error(`Document not found: ${docId}`);
  return document;
}

function blockIndex(document, blockId) {
  const index = document.blocks.findIndex(block => block.id === blockId);
  if (index < 0) throw new Error(`Live block not found: ${blockId}`);
  return index;
}

export function editBlock(w, docId, blockId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Block patch must be an object');
  const fields = new Set(['type', 'text', 'checked', 'target', 'assetId', 'url']);
  for (const key of Object.keys(patch)) if (!fields.has(key)) throw new Error(`Cannot edit block field: ${key}`);
  if (Object.hasOwn(patch, 'type') && !BLOCK_TYPES.has(patch.type)) throw new Error('Invalid block type');
  if (Object.hasOwn(patch, 'text') && (typeof patch.text !== 'string' || patch.text.length > MAX_TEXT)) throw new Error('Block text must be a string of at most 1000000 characters');
  if (patch.checked !== undefined && typeof patch.checked !== 'boolean') throw new Error('Block checked must be boolean');
  if (patch.url !== undefined && (!safeUrl(patch.url) || safeUrl(patch.url) !== patch.url)) throw new Error('Block URL must be a safe absolute URL');
  return change(w, next => {
    const document = documentById(next, docId);
    const block = document.blocks[blockIndex(document, blockId)];
    Object.assign(block, clone(patch));
    // Undefined optional fields explicitly remove metadata when changing block type.
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete block[key];
    document.updatedAt = now();
  });
}

export function renameDocument(w, docId, title) {
  if (typeof title !== 'string' || title.length > 1000) throw new Error('Document title must be a string of at most 1000 characters');
  return change(w, next => {
    const document = documentById(next, docId);
    document.title = title;
    document.updatedAt = now();
  });
}

export function splitBlock(w, docId, blockId, offset) {
  return change(w, next => {
    const document = documentById(next, docId);
    const index = blockIndex(document, blockId);
    const block = document.blocks[index];
    if (!Number.isInteger(offset) || offset < 0 || offset > block.text.length) throw new Error('Split offset must be an integer within the block text');
    const second = { ...clone(block), id: id('block'), text: block.text.slice(offset) };
    block.text = block.text.slice(0, offset);
    document.blocks.splice(index + 1, 0, second);
    document.updatedAt = now();
  });
}

export function mergeBlocks(w, docId, firstId, secondId) {
  if (firstId === secondId) throw new Error('Cannot merge a block with itself');
  return change(w, next => {
    const document = documentById(next, docId);
    const first = document.blocks[blockIndex(document, firstId)];
    const secondIndex = blockIndex(document, secondId);
    const second = document.blocks[secondIndex];
    if (first.text.length + second.text.length > MAX_TEXT) throw new Error('Merged block exceeds 1000000 characters');
    // Exact concatenation makes splitting and immediately merging lossless.
    first.text += second.text;
    document.deletedBlocks.push({ ...second, originalIndex: secondIndex });
    document.blocks.splice(secondIndex, 1);
    document.updatedAt = now();
  });
}

export function deleteBlock(w, docId, blockId) {
  return change(w, next => {
    const document = documentById(next, docId);
    const index = blockIndex(document, blockId);
    const [block] = document.blocks.splice(index, 1);
    document.deletedBlocks.push({ ...block, originalIndex: index });
    document.updatedAt = now();
  });
}

export function restoreBlock(w, docId, blockId) {
  return change(w, next => {
    const document = documentById(next, docId);
    const index = document.deletedBlocks.findIndex(block => block.id === blockId);
    if (index < 0) throw new Error(`Deleted block not found: ${blockId}`);
    const [{ originalIndex, ...block }] = document.deletedBlocks.splice(index, 1);
    document.blocks.splice(Math.min(originalIndex, document.blocks.length), 0, block);
    document.updatedAt = now();
  });
}

export function setDocumentStatus(w, docId, status) {
  if (!STATUSES.has(status)) throw new Error(`Invalid document status: ${status}`);
  return change(w, next => {
    const document = documentById(next, docId);
    document.status = status;
    document.updatedAt = now();
  });
}

export function resolvePlacement(w, placement) {
  if (placement.kind === 'frozen') {
    return {
      state: 'frozen', title: placement.text || 'Frozen excerpt', blocks: clone(placement.snapshot ?? []), missingIds: [],
      provenance: { type: 'snapshot', documentId: placement.documentId ?? null, capturedAt: placement.capturedAt ?? null },
    };
  }
  if (placement.kind === 'note') {
    return { state: 'live', title: 'Note', blocks: [{ id: placement.id, type: 'paragraph', text: placement.text ?? '' }], missingIds: [], provenance: null };
  }
  if (placement.kind === 'image') {
    const asset = w.assets.find(item => item.id === placement.assetId);
    return {
      state: asset ? 'live' : 'missing', title: placement.text || asset?.name || 'Image',
      blocks: asset ? [{ id: placement.id, type: 'image', text: placement.text ?? '', assetId: asset.id }] : [],
      missingIds: asset ? [] : [placement.assetId].filter(Boolean), provenance: null,
    };
  }
  const document = w.documents.find(doc => doc.id === placement.documentId);
  if (!document) return { state: 'missing', title: 'Missing document', blocks: [], missingIds: [placement.documentId].filter(Boolean), provenance: null };
  const byId = new Map(document.blocks.map(block => [block.id, block]));
  const requested = placement.kind === 'excerpt' ? placement.blockIds ?? [] : document.blocks.map(block => block.id);
  const missingIds = requested.filter(blockId => !byId.has(blockId));
  const state = document.status !== 'active' ? document.status : missingIds.length ? 'missing' : 'live';
  return {
    state, title: document.title,
    blocks: state === 'trashed' ? [] : clone(requested.filter(blockId => byId.has(blockId)).map(blockId => byId.get(blockId))),
    missingIds, provenance: clone(document.provenance),
  };
}

export function search(w, query, { tag, type } = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const terms = [...new Set(needle.split(/\s+/))];
  const results = [];
  for (const document of w.documents) {
    if (document.status !== 'active' || (tag && !document.tags.some(value => value.toLowerCase() === tag.trim().toLowerCase()))) continue;
    const title = document.title.toLowerCase();
    const blocks = document.blocks.length ? document.blocks : [{ id: null, type: null, text: '' }];
    for (const block of blocks) {
      if (type && block.type !== type) continue;
      const body = block.text.toLowerCase();
      if (!terms.every(term => title.includes(term) || body.includes(term))) continue;
      const score = terms.reduce((total, term) => total + (title.includes(term) ? 8 : 0) + (body.includes(term) ? 2 : 0), title === needle ? 20 : 0);
      results.push({ documentId: document.id, blockId: block.id, title: document.title, text: block.text, score });
    }
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return results.sort((a, b) => b.score - a.score || compare(a.title.toLowerCase(), b.title.toLowerCase()) || compare(a.documentId, b.documentId) || compare(a.blockId ?? '', b.blockId ?? ''));
}

export function backlinks(w, docId) {
  const results = [];
  for (const document of w.documents) {
    if (document.status !== 'active') continue;
    for (const block of document.blocks) {
      if (block.target?.documentId === docId) results.push({ documentId: document.id, blockId: block.id, title: document.title, text: block.text, target: clone(block.target) });
    }
  }
  return results;
}

export function safeUrl(url) {
  if (typeof url !== 'string' || url.length > 8192) return '';
  const value = url.trim();
  if (!value || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(value)) return '';
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'mailto:') return parsed.pathname && !/%0[ad]/i.test(value) ? value : '';
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? value : '';
  } catch {
    return '';
  }
}

export function parseMarkdown(text, filename = 'Untitled.md') {
  if (typeof text !== 'string' || text.length > MAX_PACKAGE) throw new Error('Markdown must be a string of at most 25 MiB characters');
  if (typeof filename !== 'string' || filename.length > 1000) throw new Error('Markdown filename must be a string of at most 1000 characters');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const add = (type, body, extra = {}) => {
    if (body.length > MAX_TEXT) throw new Error('Markdown block exceeds 1000000 characters');
    if (blocks.length >= 100000) throw new Error('Markdown exceeds 100000 blocks');
    blocks.push({ id: id('block'), type, text: body, ...extra });
  };
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) add('paragraph', paragraph.join('\n'));
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})[^\n]*$/);
    if (fence) {
      flush();
      const code = [];
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++index < lines.length && !closing.test(lines[index])) code.push(lines[index]);
      add('code', code.join('\n'));
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^ {0,3}(#{1,3})(?:[ \t]+(.*)|[ \t]*)$/);
    const checklist = line.match(/^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/);
    const list = line.match(/^\s*(?:[-+*]|\d+[.)])\s+(.*)$/);
    const quote = line.match(/^ {0,3}> ?(.*)$/);
    const media = line.trim().match(/^(!?)\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)$/);
    const url = media ? safeUrl(media[3]) : '';
    if (heading || checklist || list || quote || (url && (!media[1] || /^https?:/i.test(url)))) {
      flush();
      if (heading) add(`heading${heading[1].length}`, (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim());
      else if (checklist) add('checklist', checklist[2], { checked: checklist[1].toLowerCase() === 'x' });
      else if (list) add('list', list[1]);
      else if (quote) {
        const content = [quote[1]];
        while (index + 1 < lines.length && /^ {0,3}>/.test(lines[index + 1])) content.push(lines[++index].replace(/^ {0,3}> ?/, ''));
        add('quote', content.join('\n'));
      } else add(media[1] ? 'image' : 'link', media[2], { url });
    } else paragraph.push(line);
  }
  flush();
  const timestamp = now();
  const fallback = filename.split(/[\\/]/).pop().replace(/\.(?:md|markdown|txt)$/i, '') || 'Untitled';
  return {
    id: id('document'), title: (blocks.find(block => block.type === 'heading1')?.text || fallback).slice(0, 1000),
    summary: '', tags: [], blocks, deletedBlocks: [], status: 'active',
    provenance: { type: 'markdown', filename, importedAt: timestamp }, createdAt: timestamp, updatedAt: timestamp,
  };
}

export function exportMarkdown(w, docId) {
  const document = documentById(w, docId);
  const escape = text => text.replace(/([\\`*_{}\[\]<>])/g, '\\$1').replace(/^(\s*)(#{1,6}|[-+]|\d+[.)])(?=\s)/gm, '$1\\$2');
  const destination = url => url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E');
  const parts = document.blocks.map(block => {
    const text = escape(block.text);
    if (/^heading[123]$/.test(block.type)) return `${'#'.repeat(Number(block.type.slice(-1)))} ${text}`;
    if (block.type === 'list') return `- ${text.replace(/\n/g, '\n  ')}`;
    if (block.type === 'checklist') return `- [${block.checked ? 'x' : ' '}] ${text.replace(/\n/g, '\n  ')}`;
    if (block.type === 'quote') return text.split('\n').map(line => `> ${line}`).join('\n');
    if (block.type === 'code') {
      const runs = block.text.match(/`+/g) ?? [];
      const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
      return `${fence}\n${block.text}\n${fence}`;
    }
    if (block.type === 'link') {
      const target = block.target;
      const url = target ? `#${encodeURIComponent(target.documentId)}${target.blockId ? `/${encodeURIComponent(target.blockId)}` : ''}` : safeUrl(block.url);
      return url ? `[${text}](${destination(url)})` : text;
    }
    if (block.type === 'image') {
      const asset = w.assets.find(item => item.id === block.assetId);
      const url = asset?.data ?? safeUrl(block.url);
      return url && /^(https?:|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(url) ? `![${text}](${destination(url)})` : text;
    }
    return text;
  });
  if (document.blocks[0]?.type !== 'heading1' || document.blocks[0].text !== document.title) parts.unshift(`# ${escape(document.title)}`);
  return `${parts.join('\n\n')}\n`;
}

export function validateWorkspace(value) {
  const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
  // Check JSON fidelity before stringification, which otherwise hides NaN and undefined.
  const ancestors = new Set();
  const json = (item, path, depth = 0) => {
    if (depth > 30) fail(path, 'JSON nesting exceeds 30 levels');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail(path, 'must be finite'); return; }
    if (typeof item !== 'object') fail(path, 'must contain only JSON values');
    if (ancestors.has(item)) fail(path, 'cyclic data is not allowed');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail(path, 'must be a plain object');
    ancestors.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) fail(path, 'must contain only plain JSON properties');
      if (Array.isArray(item) && !/^(0|[1-9]\d*)$/.test(key)) fail(path, 'array has an invalid property');
      json(descriptor.value, `${path}.${key}`, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail(path, 'sparse arrays are not allowed');
    ancestors.delete(item);
  };
  json(value, 'workspace');
  if (JSON.stringify(value).length > MAX_PACKAGE) fail('workspace', 'package exceeds 25 MiB characters');
  const object = (item, path, required, optional = []) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(path, 'must be an object');
    for (const key of required) if (!Object.hasOwn(item, key)) fail(`${path}.${key}`, 'is required');
    for (const key of Object.keys(item)) if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, 'unknown field');
  };
  const string = (item, path, max = MAX_TEXT, nonempty = false) => {
    if (typeof item !== 'string' || item.length > max || (nonempty && !item.trim())) fail(path, `must be ${nonempty ? 'a nonempty' : 'a'} string of at most ${max} characters`);
  };
  const array = (item, path, max) => { if (!Array.isArray(item) || item.length > max) fail(path, `must be an array with at most ${max} entries`); };
  const number = (item, path, min, max) => { if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max) fail(path, `must be finite and between ${min} and ${max}`); };
  const timestamp = (item, path) => {
    string(item, path, 64, true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(item) || !Number.isFinite(Date.parse(item))) fail(path, 'must be an ISO timestamp');
  };
  const identifier = (item, path) => { if (typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(item)) fail(path, 'must be a 1-128 character identifier'); };
  const ids = new Set();
  const register = (item, path) => {
    identifier(item, path);
    if (ids.has(item)) fail(path, `duplicate global ID ${item}`);
    ids.add(item);
  };
  const geometry = (item, path) => {
    for (const key of ['x', 'y']) number(item[key], `${path}.${key}`, -10_000_000, 10_000_000);
    for (const key of ['w', 'h']) number(item[key], `${path}.${key}`, 0.001, 10_000_000);
  };
  const references = [];
  const assetReferences = [];
  let blockCount = 0;
  const block = (item, path, deleted = false, snapshot = false) => {
    object(item, path, ['id', 'type', 'text', ...(deleted ? ['originalIndex'] : [])], ['checked', 'target', 'assetId', 'url']);
    if (++blockCount > 100000) fail(path, 'total blocks, tombstones and snapshot blocks exceed 100000');
    if (snapshot) identifier(item.id, `${path}.id`); else register(item.id, `${path}.id`);
    if (!BLOCK_TYPES.has(item.type)) fail(`${path}.type`, 'invalid block type');
    string(item.text, `${path}.text`);
    if (Object.hasOwn(item, 'checked') && typeof item.checked !== 'boolean') fail(`${path}.checked`, 'must be boolean');
    if (deleted && (!Number.isInteger(item.originalIndex) || item.originalIndex < 0 || item.originalIndex > 100000)) fail(`${path}.originalIndex`, 'must be an integer between 0 and 100000');
    if (Object.hasOwn(item, 'target')) {
      object(item.target, `${path}.target`, ['documentId'], ['blockId']);
      identifier(item.target.documentId, `${path}.target.documentId`);
      if (Object.hasOwn(item.target, 'blockId')) identifier(item.target.blockId, `${path}.target.blockId`);
      references.push({ documentId: item.target.documentId, blockIds: item.target.blockId ? [item.target.blockId] : [], path: `${path}.target` });
    }
    if (Object.hasOwn(item, 'assetId')) { identifier(item.assetId, `${path}.assetId`); assetReferences.push([item.assetId, `${path}.assetId`]); }
    if (Object.hasOwn(item, 'url')) {
      if (!safeUrl(item.url) || safeUrl(item.url) !== item.url || (item.type === 'image' && !/^https?:/i.test(item.url))) fail(`${path}.url`, 'must be a safe absolute http, https or mailto URL (images require http/https)');
    }
  };
  object(value, 'workspace', ['version', 'id', 'name', 'documents', 'boards', 'assets', 'createdAt']);
  if (value.version !== 1) fail('workspace.version', 'unsupported version; expected 1');
  register(value.id, 'workspace.id');
  string(value.name, 'workspace.name', 1000, true);
  timestamp(value.createdAt, 'workspace.createdAt');
  array(value.documents, 'workspace.documents', 10000);
  array(value.boards, 'workspace.boards', 1000);
  array(value.assets, 'workspace.assets', 1000);
  const documents = new Map();
  value.documents.forEach((document, index) => {
    const path = `documents[${index}]`;
    object(document, path, ['id', 'title', 'summary', 'tags', 'blocks', 'deletedBlocks', 'status', 'provenance', 'createdAt', 'updatedAt']);
    register(document.id, `${path}.id`);
    string(document.title, `${path}.title`, 1000);
    string(document.summary, `${path}.summary`, 10000);
    array(document.tags, `${path}.tags`, 100);
    document.tags.forEach((tag, tagIndex) => string(tag, `${path}.tags[${tagIndex}]`, 100, true));
    if (new Set(document.tags).size !== document.tags.length) fail(`${path}.tags`, 'duplicate tags');
    if (!STATUSES.has(document.status)) fail(`${path}.status`, 'invalid document status');
    if (document.provenance !== null && typeof document.provenance !== 'string' && (typeof document.provenance !== 'object' || Array.isArray(document.provenance))) fail(`${path}.provenance`, 'must be an object, string or null');
    if (JSON.stringify(document.provenance).length > 16384) fail(`${path}.provenance`, 'exceeds 16384 characters');
    timestamp(document.createdAt, `${path}.createdAt`);
    timestamp(document.updatedAt, `${path}.updatedAt`);
    array(document.blocks, `${path}.blocks`, 100000);
    array(document.deletedBlocks, `${path}.deletedBlocks`, 100000);
    document.blocks.forEach((item, n) => block(item, `${path}.blocks[${n}]`));
    document.deletedBlocks.forEach((item, n) => block(item, `${path}.deletedBlocks[${n}]`, true));
    documents.set(document.id, new Set([...document.blocks, ...document.deletedBlocks].map(item => item.id)));
  });
  const assets = new Set();
  value.assets.forEach((asset, index) => {
    const path = `assets[${index}]`;
    object(asset, path, ['id', 'name', 'mime', 'data']);
    register(asset.id, `${path}.id`);
    assets.add(asset.id);
    string(asset.name, `${path}.name`, 1000, true);
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(asset.mime)) fail(`${path}.mime`, 'only PNG, JPEG, GIF and WebP raster assets are allowed');
    string(asset.data, `${path}.data`, 12 * 1024 * 1024, true);
    const prefix = `data:${asset.mime};base64,`;
    if (!asset.data.startsWith(prefix)) fail(`${path}.data`, 'must be a base64 data URL matching the asset MIME');
    const encoded = asset.data.slice(prefix.length);
    if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail(`${path}.data`, 'invalid base64 raster data');
    const bytes = atob(encoded.slice(0, 24));
    const signatures = {
      'image/png': bytes.startsWith('\x89PNG\r\n\x1a\n'),
      'image/jpeg': bytes.startsWith('\xff\xd8\xff'),
      'image/gif': bytes.startsWith('GIF87a') || bytes.startsWith('GIF89a'),
      'image/webp': bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP',
    };
    if (!signatures[asset.mime]) fail(`${path}.data`, 'raster signature does not match MIME');
  });
  let placementCount = 0;
  let frameCount = 0;
  let relationshipCount = 0;
  value.boards.forEach((board, index) => {
    const path = `boards[${index}]`;
    object(board, path, ['id', 'name', 'description', 'placements', 'frames', 'relationships', 'camera']);
    register(board.id, `${path}.id`);
    string(board.name, `${path}.name`, 1000, true);
    string(board.description, `${path}.description`, 10000);
    object(board.camera, `${path}.camera`, ['x', 'y', 'zoom']);
    for (const key of ['x', 'y']) number(board.camera[key], `${path}.camera.${key}`, -10_000_000, 10_000_000);
    number(board.camera.zoom, `${path}.camera.zoom`, MIN_ZOOM, MAX_ZOOM);
    array(board.placements, `${path}.placements`, 50000);
    array(board.frames, `${path}.frames`, 10000);
    array(board.relationships, `${path}.relationships`, 100000);
    placementCount += board.placements.length;
    frameCount += board.frames.length;
    relationshipCount += board.relationships.length;
    if (placementCount > 50000 || frameCount > 10000 || relationshipCount > 100000) fail(path, 'total placements, frames or relationships exceed workspace bounds');
    const endpoints = new Set();
    board.placements.forEach((placement, n) => {
      const location = `${path}.placements[${n}]`;
      object(placement, location, ['id', 'kind', 'x', 'y', 'w', 'h'], ['documentId', 'blockIds', 'text', 'assetId', 'snapshot', 'capturedAt', 'view']);
      register(placement.id, `${location}.id`);
      endpoints.add(placement.id);
      if (!PLACEMENT_TYPES.has(placement.kind)) fail(`${location}.kind`, 'invalid placement kind');
      geometry(placement, location);
      if (Object.hasOwn(placement, 'view')) {
        object(placement.view, `${location}.view`, ['scrollTop']);
        number(placement.view.scrollTop, `${location}.view.scrollTop`, 0, 10_000_000);
      }
      if (Object.hasOwn(placement, 'text')) string(placement.text, `${location}.text`);
      if (['document', 'excerpt'].includes(placement.kind) && !placement.documentId) fail(`${location}.documentId`, 'is required for document/excerpt placements');
      if (Object.hasOwn(placement, 'documentId')) {
        identifier(placement.documentId, `${location}.documentId`);
        references.push({ documentId: placement.documentId, blockIds: placement.blockIds ?? [], path: location });
      }
      if (Object.hasOwn(placement, 'blockIds')) {
        array(placement.blockIds, `${location}.blockIds`, 100000);
        if (!placement.documentId) fail(`${location}.blockIds`, 'requires a documentId');
        placement.blockIds.forEach((item, i) => identifier(item, `${location}.blockIds[${i}]`));
        if (new Set(placement.blockIds).size !== placement.blockIds.length) fail(`${location}.blockIds`, 'duplicate block reference');
      }
      if (placement.kind === 'excerpt' && !placement.blockIds?.length) fail(`${location}.blockIds`, 'excerpt requires at least one block ID');
      if (placement.kind === 'frozen' && !Array.isArray(placement.snapshot)) fail(`${location}.snapshot`, 'frozen placement requires a snapshot');
      if (Object.hasOwn(placement, 'snapshot')) {
        if (placement.kind !== 'frozen') fail(`${location}.snapshot`, 'only frozen placements may contain snapshots');
        array(placement.snapshot, `${location}.snapshot`, 100000);
        const snapshotIds = new Set();
        placement.snapshot.forEach((item, i) => {
          block(item, `${location}.snapshot[${i}]`, false, true);
          // Copies retain source IDs; uniqueness is local to each snapshot.
          if (snapshotIds.has(item.id)) fail(`${location}.snapshot[${i}].id`, 'duplicate snapshot block ID');
          snapshotIds.add(item.id);
        });
      }
      if (Object.hasOwn(placement, 'capturedAt')) timestamp(placement.capturedAt, `${location}.capturedAt`);
      if (placement.kind === 'image' && !placement.assetId) fail(`${location}.assetId`, 'image placement requires an asset');
      if (Object.hasOwn(placement, 'assetId')) { identifier(placement.assetId, `${location}.assetId`); assetReferences.push([placement.assetId, `${location}.assetId`]); }
    });
    board.frames.forEach((frame, n) => {
      const location = `${path}.frames[${n}]`;
      object(frame, location, ['id', 'title', 'x', 'y', 'w', 'h', 'color']);
      register(frame.id, `${location}.id`);
      endpoints.add(frame.id);
      string(frame.title, `${location}.title`, 1000);
      string(frame.color, `${location}.color`, 64, true);
      if (!/^(?:#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})|[a-zA-Z][a-zA-Z0-9-]{0,31})$/.test(frame.color)) fail(`${location}.color`, 'must be a hex color or color name');
      geometry(frame, location);
    });
    board.relationships.forEach((relationship, n) => {
      const location = `${path}.relationships[${n}]`;
      object(relationship, location, ['id', 'from', 'to', 'type', 'label', 'directed']);
      register(relationship.id, `${location}.id`);
      string(relationship.type, `${location}.type`, 100, true);
      string(relationship.label, `${location}.label`, 1000);
      if (typeof relationship.directed !== 'boolean') fail(`${location}.directed`, 'must be boolean');
      for (const key of ['from', 'to']) if (!endpoints.has(relationship[key])) fail(`${location}.${key}`, 'relationship endpoint must exist on the same board');
    });
  });
  for (const reference of references) {
    const blocks = documents.get(reference.documentId);
    if (!blocks) fail(reference.path, `references nonexistent document ${reference.documentId}`);
    for (const blockId of reference.blockIds) if (!blocks.has(blockId)) fail(reference.path, `references nonexistent block ${blockId} in document ${reference.documentId}`);
  }
  for (const [assetId, path] of assetReferences) if (!assets.has(assetId)) fail(path, `references nonexistent asset ${assetId}`);
  return value;
}

export function exportPackage(w) {
  return JSON.stringify(validateWorkspace(w));
}

export class WorkspaceStore {
  constructor(storage = globalThis.localStorage) {
    if (!storage || !['getItem', 'setItem', 'removeItem'].every(method => typeof storage[method] === 'function')) throw new Error('WorkspaceStore requires a synchronous Storage implementation');
    this.storage = storage;
  }

  list() {
    const raw = this.storage.getItem(INDEX_KEY);
    if (raw === null) return [];
    if (raw.length > MAX_PACKAGE) throw new Error('Corrupt workspace index: exceeds 25 MiB characters');
    let entries;
    try { entries = JSON.parse(raw); } catch (error) { throw new Error(`Corrupt workspace index: ${error.message}`, { cause: error }); }
    if (!Array.isArray(entries) || entries.length > 10000) throw new Error('Corrupt workspace index: expected at most 10000 entries');
    const ids = new Set();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 3 ||
          typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(entry.id) || ids.has(entry.id) ||
          typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 1000 ||
          typeof entry.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.updatedAt) || !Number.isFinite(Date.parse(entry.updatedAt))) throw new Error('Corrupt workspace index: invalid or duplicate entry');
      ids.add(entry.id);
    }
    return entries;
  }

  load(workspaceId) {
    if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(workspaceId)) throw new Error('Invalid workspace ID');
    const raw = this.storage.getItem(`margin:workspace:${workspaceId}`);
    if (raw === null) return null;
    try {
      if (raw.length > MAX_PACKAGE) throw new Error('package exceeds 25 MiB characters');
      const workspace = validateWorkspace(JSON.parse(raw));
      if (workspace.id !== workspaceId) throw new Error('stored workspace ID does not match its key');
      return workspace;
    } catch (error) { throw new Error(`Corrupt workspace ${workspaceId}: ${error.message}`, { cause: error }); }
  }

  save(w) {
    validateWorkspace(w);
    const entries = this.list();
    const key = `margin:workspace:${w.id}`;
    const previous = this.storage.getItem(key);
    const metadata = { id: w.id, name: w.name, updatedAt: now() };
    const index = entries.findIndex(entry => entry.id === w.id);
    if (index < 0) {
      if (entries.length >= 10000) throw new Error('Workspace index exceeds 10000 entries');
      entries.push(metadata);
    } else entries[index] = metadata;
    // Storage.setItem is atomic per key, but a workspace + index pair is not.
    this.storage.setItem(key, JSON.stringify(w));
    try {
      this.storage.setItem(INDEX_KEY, JSON.stringify(entries));
    } catch (error) {
      try {
        if (previous === null) this.storage.removeItem(key);
        else this.storage.setItem(key, previous);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Workspace save failed and rollback failed; persisted data may have changed');
      }
      throw new Error(`Workspace index write failed; workspace rolled back: ${error.message}`, { cause: error });
    }
    return clone(w);
  }

  create(name = 'Untitled workspace') {
    const workspace = blankWorkspace(name);
    this.save(workspace);
    return workspace;
  }
}

export class History {
  constructor(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('History limit must be an integer between 1 and 10000');
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  push(previous) {
    this.past.push(clone(previous));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current) {
    if (!this.canUndo) return clone(current);
    this.future.push(clone(current));
    return clone(this.past.pop());
  }

  redo(current) {
    if (!this.canRedo) return clone(current);
    this.past.push(clone(current));
    if (this.past.length > this.limit) this.past.shift();
    return clone(this.future.pop());
  }

  clear() { this.past = []; this.future = []; }
}

function finitePoint(point, name) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${name} must have finite x and y coordinates`);
}

export function screenToWorld(point, camera) {
  finitePoint(point, 'Point');
  finitePoint(camera, 'Camera');
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) throw new Error('Camera zoom must be finite and positive');
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

export function zoomAt(camera, point, newZoom) {
  if (!Number.isFinite(newZoom) || newZoom <= 0) throw new Error('New zoom must be finite and positive');
  const world = screenToWorld(point, camera);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
}

export function fitCamera(placements, width, height, padding = 100) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(padding) || padding < 0) throw new Error('Viewport dimensions must be finite and positive; padding must be finite and nonnegative');
  if (!Array.isArray(placements)) throw new Error('Placements must be an array');
  if (!placements.length) return { x: 0, y: 0, zoom: 1 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const placement of placements) {
    finitePoint(placement, 'Placement');
    if (!Number.isFinite(placement.w) || placement.w <= 0 || !Number.isFinite(placement.h) || placement.h <= 0) throw new Error('Placement dimensions must be finite and positive');
    left = Math.min(left, placement.x);
    top = Math.min(top, placement.y);
    right = Math.max(right, placement.x + placement.w);
    bottom = Math.max(bottom, placement.y + placement.h);
  }
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(Math.max(1, width - padding * 2) / (right - left), Math.max(1, height - padding * 2) / (bottom - top))));
  return { x: width / 2 - (left + (right - left) / 2) * zoom, y: height / 2 - (top + (bottom - top) / 2) * zoom, zoom };
}
