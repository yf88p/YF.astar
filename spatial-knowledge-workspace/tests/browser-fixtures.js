import { createSeed } from '../src/seed.js';
import { validateWorkspace } from '../src/core.js';

const timestamp = '2026-05-22T16:30:00.000Z';
export const passage = 'Copper lantern protocol: keep a seat available without requiring a purchase. Record the arrival route, the posted closing time, and who maintains the invitation before recommending a public trial.';
export const revision = 'Copper lantern revision: a paid host explains the closing time and keeps the accessible route clear. The invitation must remain optional, reversible, and affordable for the people maintaining it.';

export function browserFixture() {
  const document = (id, title, tags, blocks) => ({
    id, title, summary: 'Synthetic browser acceptance research, not observations of real people.',
    tags, blocks, deletedBlocks: [], status: 'active',
    provenance: { type: 'synthetic browser fixture' }, createdAt: timestamp, updatedAt: timestamp,
  });
  const board = (id, name, placements) => ({
    id, name, description: 'A synthetic acceptance workspace. Sources remain canonical.',
    placements, frames: [], relationships: [], camera: { x: 40, y: 55, zoom: 1 },
  });
  return validateWorkspace({
    version: 1, id: 'browser-workspace', name: 'Browser research', createdAt: timestamp, assets: [],
    documents: [
      document('source', 'Threshold research', ['access', 'field notes'], [
        { id: 'source-heading', type: 'heading2', text: 'An invitation with an honest boundary' },
        { id: 'source-passage', type: 'paragraph', text: passage },
        { id: 'source-quote', type: 'quote', text: 'A doorway can welcome someone without demanding a story in return.' },
        { id: 'source-method', type: 'paragraph', text: 'Separate permission to arrive from pressure to participate. Compare a posted invitation with a staffed welcome, document the access barriers, and publish a stopping rule before a future trial.' },
        { id: 'source-link', type: 'link', text: 'Compare the cost of a staffed invitation.', target: { documentId: 'cost', blockId: 'cost-passage' } },
      ]),
      document('cost', 'The cost of welcome', ['costs'], [
        { id: 'cost-heading', type: 'heading2', text: 'Paid care is part of the offer' },
        { id: 'cost-passage', type: 'paragraph', text: 'A free seat is not free to maintain. Budget for cleaning, predictable host shifts, accessible toilets, and an agreed route for reporting problems without making visitors responsible for unpaid work.' },
      ]),
      document('review', 'Review before expanding', ['access'], [
        { id: 'review-passage', type: 'paragraph', text: 'Compare copper costs against lantern maintenance before choosing a protocol. These separated words are a deliberate search distractor, not the source passage.' },
        { id: 'review-quote', type: 'quote', text: 'Copper lantern protocol should be reviewed with hosts, not imposed on them.' },
      ]),
    ],
    boards: [
      board('board-source', 'Research desk', [
        { id: 'source-card', kind: 'document', documentId: 'source', x: 25, y: 35, w: 330, h: 340 },
        { id: 'cost-card', kind: 'document', documentId: 'cost', x: 445, y: 35, w: 330, h: 340 },
      ]),
      board('board-target', 'Evidence wall', []),
    ],
  });
}

export const performancePhrase = index => `Research-index-${String(index).padStart(4, '0')} arrival boundary`;

export function performanceFixture() {
  const seed = createSeed();
  const documents = Array.from({ length: 500 }, (_, index) => {
    const source = seed.documents[index % seed.documents.length];
    const doc = structuredClone(source);
    doc.id = `perf-doc-${index}`;
    doc.title = `Research ${String(index).padStart(4, '0')} / ${source.title}`;
    doc.summary = `Synthetic research-index ${index}; variant ${Math.floor(index / seed.documents.length)}. ${source.summary}`;
    doc.provenance = { type: 'synthetic performance workload', source: source.id, researchIndex: index };
    doc.deletedBlocks = [];
    doc.blocks = doc.blocks.map((block, blockIndex) => ({
      ...block, id: `perf-block-${index}-${blockIndex}`,
      text: `${blockIndex === 1 ? performancePhrase(index) : `Research-index-${index} section-${blockIndex}`}. ${block.text}`,
      ...(block.target ? { target: { documentId: `perf-doc-${(index + 1) % 500}`, blockId: `perf-block-${(index + 1) % 500}-1` } } : {}),
    }));
    return doc;
  });
  // Two visible placements of doc 0 exercise canonical and live excerpt rendering together.
  const placements = Array.from({ length: 300 }, (_, index) => ({
    id: `perf-placement-${index}`, kind: index % 3 === 1 ? 'excerpt' : 'document',
    documentId: `perf-doc-${index === 1 ? 0 : index}`,
    ...(index % 3 === 1 ? { blockIds: [`perf-block-${index === 1 ? 0 : index}-1`] } : {}),
    x: index % 20 * 390 + 25, y: Math.floor(index / 20) * 340 + 35, w: 330, h: 285,
  }));
  const workspace = validateWorkspace({
    version: 1, id: 'perf-workspace', name: 'Synthetic 500-document research index', createdAt: timestamp,
    documents, assets: [], boards: [{
      id: 'perf-board', name: 'Research index / 300 placements',
      description: 'Synthetic expanded Common Ground research. Repeated source studies have distinct research indices and remapped links.',
      placements, frames: [], camera: { x: 35, y: 45, zoom: 1 },
      relationships: Array.from({ length: 150 }, (_, index) => ({
        id: `perf-relationship-${index}`, from: `perf-placement-${index * 2}`, to: `perf-placement-${index * 2 + 1}`,
        type: ['supports', 'questions', 'extends'][index % 3],
        label: `Synthetic comparison ${index}: preserve the boundary between an invitation and a social obligation.`, directed: true,
      })),
    }],
  });
  const blocks = documents.flatMap(doc => doc.blocks);
  const json = JSON.stringify(workspace);
  return { workspace, counts: {
    documents: documents.length, blocks: blocks.length, placements: placements.length,
    liveExcerpts: placements.filter(p => p.kind === 'excerpt').length,
    internalLinks: blocks.filter(b => b.target).length, relationships: workspace.boards[0].relationships.length,
    totalLinks: blocks.filter(b => b.target).length + workspace.boards[0].relationships.length,
    assets: 0, tombstones: 0, utf8Bytes: Buffer.byteLength(json), utf16Bytes: json.length * 2,
    documentTextBytes: Buffer.byteLength(blocks.map(b => b.text).join('\n')),
    words: blocks.reduce((count, block) => count + block.text.split(/\s+/).length, 0),
  } };
}

export const markdownUpload = {
  name: 'arrival-study.md', mimeType: 'text/markdown',
  buffer: Buffer.from('# Arrival study\n\nA reversible welcome needs a paid host and a clear closing time.\n\n> The invitation is not an obligation.\n\n- [ ] Review the accessible route\n\n```text\ntrial: reversible\n```\n'),
};
export const imageUpload = {
  name: 'local-boundary.png', mimeType: 'image/png',
  // Opaque 240 x 144 synthetic access-card diagram, large enough for visual verification.
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAPAAAACQCAIAAAC5w3GfAAACNklEQVR4nO3asTEEABCG0WtOrgcBuT7UoBD1CCRGZkQKEBh3x67v3swrYGf2C//D69szZBzGL4AzEjQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUn4c9PXtFfwZQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETcqKoD/eX+BbgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBk1IL+unxZonx114mQQs6RdCCThH0oqDvH+74StArCFrQgp6vZyFBryBoQQt6vp6FBL2CoAUt6Pl6FhL0CkcEzekELegUQQs6RdCCThG0oFMELegUQQs6RdCCThG0oFMELegUQQs6RdCCThG0oFMELegUQQs6RdCLgh5fHu8k6BUELWhBz9ezkKBXELSgBT1fz0KCXkHQghb0fD0LCXqFI4LmdIIWdIqgBZ0iaEGnCFrQKYIWdIqgBZ0iaEGnCFrQKYIWdIqgBZ0iaEGnCFrQKYIWdIqgBZ0i6EVBjy+PdxL0CoIWtKDn61lI0CsIWtCCnq9nIUGvIGhBC3q+noUEvcIRQXM6QQs6RdCCThG0oFMELegUQQs6pRY0F07QpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEn5N0HDuQiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSfj1o2EzQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmfhXg3AylOz1AAAAAASUVORK5CYII=', 'base64'),
};
