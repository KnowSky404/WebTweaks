import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const userscriptPath = new URL('./conversation-enhancer.user.js', import.meta.url);
const source = await readFile(userscriptPath, 'utf8');
const marker = '\n  initialize();\n})();';
const instrumented = source.replace(marker, '\n  globalThis.__projection = { inferRelationships, deriveVisibleThread };\n})();');

if (instrumented === source) throw new Error('userscript test hook marker not found');

const sandbox = { console };
sandbox.globalThis = sandbox;
vm.runInNewContext(instrumented, sandbox, { filename: userscriptPath.pathname });

const { inferRelationships, deriveVisibleThread } = sandbox.__projection;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function reply(id, floor, page, author, mentionedAuthor = null, explicitReplyFloor = null) {
  const hasMention = Boolean(mentionedAuthor);
  return {
    id,
    floor,
    page,
    author,
    normalizedAuthor: author.toLowerCase(),
    normalizedMentions: hasMention ? [{ name: mentionedAuthor, normalized: mentionedAuthor.toLowerCase() }] : [],
    explicitReplyFloor,
    hasMultipleStructuralMentions: false,
    hasStructuralMention: hasMention,
    parentId: null,
    relationshipConfidence: 'root',
    unresolvedReason: '',
    children: []
  };
}

const allReplies = [
  reply('p1-unrelated-a', 1, 1, 'A'),
  reply('p1-parent', 2, 1, 'Alice'),
  reply('p1-unrelated-b', 3, 1, 'C'),
  reply('p2-root', 101, 2, 'D'),
  reply('p2-cross-child', 102, 2, 'E', 'Alice', 2),
  reply('p2-root-b', 103, 2, 'F'),
  reply('p2-same-child', 104, 2, 'G', 'D', 101),
  reply('p2-shared-cross-child', 105, 2, 'H', 'Alice', 2),
  reply('p3-future', 201, 3, 'Future')
];

const models = inferRelationships(allReplies);
const page2 = deriveVisibleThread({ models, currentPage: 2 });
const visiblePage2 = [...page2.visibleIds].sort();
const expectedPage2 = [
  'p1-parent',
  'p2-cross-child',
  'p2-root',
  'p2-root-b',
  'p2-same-child',
  'p2-shared-cross-child'
].sort();

assert(JSON.stringify(visiblePage2) === JSON.stringify(expectedPage2), `page 2 visibility mismatch: ${visiblePage2}`);
assert(page2.roots.map((item) => item.id).join(',') === 'p2-root,p1-parent,p2-root-b', `page 2 root order mismatch: ${page2.roots.map((item) => item.id)}`);
assert((page2.childrenByParent.get('p1-parent') || []).map((item) => item.id).join(',') === 'p2-cross-child,p2-shared-cross-child', 'shared cross-page ancestor children mismatch');
assert((page2.childrenByParent.get('p2-root') || []).map((item) => item.id).join(',') === 'p2-same-child', 'same-page child mismatch');
assert(models.find((item) => item.id === 'p2-cross-child').parentId === 'p1-parent', 'global cross-page relationship was not retained');
assert(models.find((item) => item.id === 'p1-parent').children.map((item) => item.id).join(',') === 'p2-cross-child,p2-shared-cross-child', 'global child relationships were not retained');

const page1 = deriveVisibleThread({ models, currentPage: 1 });
assert(![...page1.visibleIds].some((id) => id.startsWith('p2-') || id.startsWith('p3-')), 'page 1 leaked later-page replies');

const page3 = deriveVisibleThread({ models, currentPage: 3 });
assert(page3.visibleIds.size === 1 && page3.visibleIds.has('p3-future'), 'page 3 visibility mismatch');

const cyclic = deriveVisibleThread({
  currentPage: 2,
  models: [
    { id: 'cycle-a', floor: 20, page: 2, parentId: 'cycle-b' },
    { id: 'cycle-b', floor: 10, page: 1, parentId: 'cycle-a' }
  ]
});
assert(cyclic.visibleIds.size === 2, 'ancestor cycle guard failed');
assert(cyclic.roots.length === 1 && cyclic.roots[0].id === 'cycle-a', 'cycle projection did not retain a renderable root');

console.log('threaded projection regression checks passed');
