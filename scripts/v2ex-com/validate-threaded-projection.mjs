import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const userscriptPath = new URL('./conversation-enhancer.user.js', import.meta.url);
const source = await readFile(userscriptPath, 'utf8');
const marker = '\n  initialize();\n})();';
const instrumented = source.replace(marker, `
  globalThis.__v2exTest = {
    runtime,
    topicContext,
    isCurrentTopic,
    topicSnapshotMatches,
    topicDomMatchesContext,
    topicStateMatchesLocation,
    observeNavigation,
    loadAllTopicPages,
    claimInitialization,
    inferRelationships,
    deriveVisibleThread,
    renderThreadedView,
    applyTopicView
  };
})();`);

if (instrumented === source) throw new Error('userscript test hook marker not found');

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.tokens = new Set();
  }

  set(value) {
    this.tokens = new Set(String(value || '').split(/\s+/).filter(Boolean));
    this.sync();
  }

  sync() {
    this.owner.classValue = [...this.tokens].join(' ');
  }

  add(...tokens) {
    tokens.forEach((token) => this.tokens.add(token));
    this.sync();
  }

  remove(...tokens) {
    tokens.forEach((token) => this.tokens.delete(token));
    this.sync();
  }

  contains(token) {
    return this.tokens.has(token);
  }

  toggle(token, force) {
    const enabled = force === undefined ? !this.tokens.has(token) : Boolean(force);
    if (enabled) this.tokens.add(token);
    else this.tokens.delete(token);
    this.sync();
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.classValue = '';
    this.classList = new FakeClassList(this);
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.id = '';
    this.textContent = '';
    this.innerHTML = '';
    this.isFragment = false;
  }

  set className(value) {
    this.classList.set(value);
  }

  get className() {
    return this.classValue;
  }

  get childElementCount() {
    return this.children.length;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get nextSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 ? this.parentElement.children[index + 1] || null : null;
  }

  get isConnected() {
    return Boolean(this.parentElement);
  }

  append(...nodes) {
    nodes.forEach((node) => {
      if (node?.isFragment) {
        const fragmentChildren = [...node.children];
        node.children = [];
        this.append(...fragmentChildren);
        return;
      }
      if (!node) return;
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    });
  }

  insertBefore(node, reference) {
    node.remove();
    const index = reference ? this.children.indexOf(reference) : -1;
    node.parentElement = this;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
    return node;
  }

  prepend(...nodes) {
    [...nodes].reverse().forEach((node) => this.insertBefore(node, this.firstChild));
  }

  before(...nodes) {
    if (!this.parentElement) return;
    nodes.forEach((node) => this.parentElement.insertBefore(node, this));
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName);
    clone.className = this.className;
    clone.hidden = this.hidden;
    clone.id = this.id;
    clone.textContent = this.textContent;
    clone.innerHTML = this.innerHTML;
    clone.dataset = { ...this.dataset };
    this.attributes.forEach((value, name) => clone.attributes.set(name, value));
    if (deep) clone.append(...this.children.map((child) => child.cloneNode(true)));
    return clone;
  }

  setAttribute(name, value) {
    if (name === 'id') this.id = String(value);
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    if (name === 'id') this.id = '';
    this.attributes.delete(name);
  }

  matches(selector) {
    return selector.split(',').some((candidate) => {
      const value = candidate.trim();
      if (value === 'img') return this.tagName === 'IMG';
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      if (value === '[data-wt-v2ex-reply-id]') return this.dataset.wtV2exReplyId !== undefined;
      return false;
    });
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  addEventListener() {}
  focus() {}
  getBoundingClientRect() { return { top: 0, bottom: 0 }; }
}

class FakeDocumentFragment extends FakeElement {
  constructor() {
    super('#fragment');
    this.isFragment = true;
  }
}

class FakeNativeReply extends FakeElement {
  constructor(id, floor, author, contentText = '') {
    super('div');
    this.id = `r_${id}`;
    this.classList.add('cell');
    this.content = new FakeElement('div');
    this.content.classList.add('reply_content');
    this.content.textContent = contentText;
    this.content.innerHTML = contentText;
    this.floor = new FakeElement('span');
    this.floor.classList.add('no');
    this.floor.textContent = String(floor);
    this.author = new FakeElement('a');
    this.author.classList.add('dark');
    this.author.textContent = author;
    this.time = new FakeElement('span');
    this.time.classList.add('ago');
    this.time.textContent = 'now';
  }

  querySelectorAll(selector) {
    const matches = {
      '.reply_content': [this.content],
      'strong a.dark': [this.author],
      'strong a[href^="/member/"]': [this.author],
      '.no': [this.floor],
      '.ago': [this.time],
      '.fr .no': [],
      '.small.fade img[alt="❤️"]': [],
      'img.avatar': [],
      '.fr': []
    };
    return matches[selector] || super.querySelectorAll(selector);
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = { dataset: {} };
    this.body = new FakeElement('body');
    this.head = new FakeElement('head');
    this.main = new FakeElement('main');
    this.topicReplies = [];
    this.currentPageMarker = null;
  }

  setTopicReplies(replies, page = null) {
    this.topicReplies = replies;
    this.main.replaceChildren(...replies);
    this.setCurrentPageMarker(page);
  }

  setCurrentPageMarker(page) {
    if (page === null) {
      this.currentPageMarker = null;
      return;
    }
    this.currentPageMarker = new FakeElement('span');
    this.currentPageMarker.textContent = String(page);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createDocumentFragment() {
    return new FakeDocumentFragment();
  }

  querySelectorAll(selector) {
    if (selector === '.ps_container .page_current') {
      return this.currentPageMarker ? [this.currentPageMarker] : [];
    }
    return selector.includes('.cell[id^="r_"]') ? this.topicReplies : [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener() {}
}

class FakeImageElement extends FakeElement {}

const fakeDocument = new FakeDocument();
const fakeLocation = {};
const scheduledCallbacks = [];
const windowListeners = new Map();
class FakeEvent {
  constructor(type) {
    this.type = type;
  }
}

function setLocationUrl(value) {
  const url = new URL(value, fakeLocation.href || 'https://www.v2ex.com/');
  fakeLocation.href = url.href;
  fakeLocation.origin = url.origin;
  fakeLocation.pathname = url.pathname;
}

const fakeWindow = {
  innerHeight: 900,
  history: {
    pushState(_state, _title, url) {
      if (url !== undefined && url !== null) setLocationUrl(url);
    },
    replaceState(_state, _title, url) {
      if (url !== undefined && url !== null) setLocationUrl(url);
    }
  },
  setTimeout(callback) {
    scheduledCallbacks.push(callback);
    return scheduledCallbacks.length;
  },
  clearTimeout() {},
  scrollBy() {},
  addEventListener(type, listener) {
    const listeners = windowListeners.get(type) || [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  },
  dispatchEvent(event) {
    (windowListeners.get(event.type) || []).forEach((listener) => listener(event));
    return true;
  }
};
const warnings = [];
const testConsole = {
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => warnings.push(args)
};
const sandbox = {
  console: testConsole,
  URL,
  document: fakeDocument,
  location: fakeLocation,
  window: fakeWindow,
  Element: FakeElement,
  Document: FakeDocument,
  HTMLImageElement: FakeImageElement,
  Event: FakeEvent
};
sandbox.globalThis = sandbox;
vm.runInNewContext(instrumented, sandbox, { filename: userscriptPath.pathname });

const {
  runtime,
  topicContext,
  isCurrentTopic,
  topicSnapshotMatches,
  topicDomMatchesContext,
  topicStateMatchesLocation,
  observeNavigation,
  loadAllTopicPages,
  claimInitialization,
  inferRelationships,
  deriveVisibleThread,
  renderThreadedView,
  applyTopicView
} = sandbox.__v2exTest;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIds(actual, expected, message) {
  const actualIds = [...actual].sort();
  const expectedIds = [...expected].sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${message}: ${actualIds}`);
}

function setLocation(page) {
  setLocationUrl(page === 1 ? 'https://www.v2ex.com/t/4242' : `https://www.v2ex.com/t/4242?p=${page}`);
}

function reply(id, floor, page, author, mentionedAuthor = null, explicitReplyFloor = null) {
  const hasMention = Boolean(mentionedAuthor);
  const nativeTemplate = new FakeElement('div');
  nativeTemplate.classList.add('cell');
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
    children: [],
    nativeTemplate,
    nativeReplyControlsTemplate: null
  };
}

function renderedIds(topic) {
  return topic.threadedView
    .querySelectorAll('[data-wt-v2ex-reply-id]')
    .map((element) => element.dataset.wtV2exReplyId);
}

function renderPage(topic, page) {
  topic.currentPage = page;
  topic.visibleThread = deriveVisibleThread(topic);
  topic.view = 'original';
  renderThreadedView(topic);
  return renderedIds(topic);
}

function topicSnapshot(page) {
  setLocation(page);
  const context = topicContext();
  return {
    key: context.key,
    currentPage: context.page,
    navigationRevision: runtime.navigationRevision
  };
}

function lifecycleTopic(page) {
  const snapshot = topicSnapshot(page);
  const currentReply = reply(`lifecycle-page-${page}`, page === 1 ? 32 : 51, page, `Page${page}`);
  const models = inferRelationships([currentReply]);
  return {
    ...snapshot,
    context: topicContext(),
    nativeReplies: [new FakeElement('div')],
    panel: null,
    threadedView: new FakeElement('section'),
    pages: [1, 2],
    maxPage: 2,
    loadedPages: new Set([page]),
    allReplies: [currentReply],
    nativeReplyControlsTemplate: null,
    models,
    visibleThread: deriveVisibleThread({ models, currentPage: page }),
    view: 'original',
    loading: false,
    incomplete: true,
    failed: false,
    duplicateIds: 0,
    statusMessage: 'ready'
  };
}

const allReplies = [
  reply('p1-unrelated-a', 1, 1, 'A'),
  reply('p1-parent', 2, 1, 'Alice'),
  reply('p1-floor-32', 32, 1, 'Stale'),
  reply('p2-root', 51, 2, 'D'),
  reply('p2-cross-child', 52, 2, 'E', 'Alice', 2),
  reply('p2-root-b', 53, 2, 'F'),
  reply('p2-same-child', 54, 2, 'G', 'D', 51),
  reply('p2-shared-cross-child', 55, 2, 'H', 'Alice', 2),
  reply('p3-future', 101, 3, 'Future')
];

const models = inferRelationships(allReplies);
const topic = {
  models,
  currentPage: 1,
  visibleThread: null,
  threadedView: new FakeElement('section'),
  nativeReplies: [new FakeElement('div'), new FakeElement('div')],
  panel: null,
  view: 'original',
  failed: false
};

// Case 1: changing pages replaces the old projection rather than appending it.
assert(renderPage(topic, 1).includes('p1-floor-32'), 'case 1 setup did not render floor 32 on page 1');
const renderedPage2 = renderPage(topic, 2);
assert(!renderedPage2.includes('p1-floor-32'), 'case 1 leaked unrelated floor 32 onto page 2');
assertIds(renderedPage2, [
  'p1-parent',
  'p2-cross-child',
  'p2-root',
  'p2-root-b',
  'p2-same-child',
  'p2-shared-cross-child'
], 'case 1 page 2 render mismatch');

// Case 2: a page-1 ancestor remains, but unrelated page-1 and future replies do not.
const page2 = deriveVisibleThread({ models, currentPage: 2 });
assert(page2.visibleIds.has('p1-parent'), 'case 2 removed the required cross-page ancestor');
assert(!page2.visibleIds.has('p1-unrelated-a'), 'case 2 leaked an unrelated page-1 reply');
assert(!page2.visibleIds.has('p1-floor-32'), 'case 2 leaked unrelated floor 32');
assert(!page2.visibleIds.has('p3-future'), 'case 2 leaked a future-page reply');
assert(page2.roots.map((item) => item.id).join(',') === 'p2-root,p1-parent,p2-root-b', `case 2 root order mismatch: ${page2.roots.map((item) => item.id)}`);
assert((page2.childrenByParent.get('p1-parent') || []).map((item) => item.id).join(',') === 'p2-cross-child,p2-shared-cross-child', 'case 2 shared ancestor children mismatch');
assert((page2.childrenByParent.get('p2-root') || []).map((item) => item.id).join(',') === 'p2-same-child', 'case 2 same-page child mismatch');
assert(models.find((item) => item.id === 'p2-cross-child').parentId === 'p1-parent', 'case 2 lost the global cross-page relationship');

// Duplicate rendering is prevented both within one topology and across rebuilds.
topic.visibleThread = {
  ...page2,
  roots: [...page2.roots, page2.roots[0]]
};
topic.currentPage = 2;
topic.view = 'original';
renderThreadedView(topic);
assertIds(renderedIds(topic), renderedPage2, 'duplicate root rendered twice');
assert(warnings.some((args) => args.includes('p2-root')), 'duplicate render guard did not report the repeated reply');
assertIds(renderPage(topic, 2), renderedPage2, 'repeated render accumulated stale nodes');

// Case 3: page 1 -> page 2 -> page 1 always rebuilds from that page's projection.
const firstPageIds = renderPage(topic, 1);
assertIds(renderPage(topic, 2), renderedPage2, 'case 3 page 2 projection mismatch');
assertIds(renderPage(topic, 1), firstPageIds, 'case 3 return to page 1 retained stale page-2 content');

// The actual History API hooks must invalidate and clean a coalesced ABA transition.
runtime.navigationRevision = 0;
runtime.navigationSchedule = 0;
setLocation(1);
const stalePage1Topic = lifecycleTopic(1);
const staleTopicHost = new FakeElement('main');
staleTopicHost.append(stalePage1Topic.threadedView);
renderThreadedView(stalePage1Topic);
applyTopicView(stalePage1Topic, 'threaded');
runtime.topic = stalePage1Topic;
observeNavigation();
const patchedPushState = fakeWindow.history.pushState;
observeNavigation();
assert(fakeWindow.history.pushState === patchedPushState, 'case 3 patched history more than once');
assert(windowListeners.get('popstate')?.length === 1, 'case 3 attached duplicate popstate listeners');
assert(windowListeners.get('wt-v2ex-navigation')?.length === 1, 'case 3 attached duplicate navigation listeners');
assert(isCurrentTopic(stalePage1Topic), 'case 3 setup topic was not current');
fakeWindow.history.pushState({}, '', '?p=2');
fakeDocument.setTopicReplies([new FakeNativeReply('fresh-page-2', 51, 'FreshPage2')], 2);
fakeWindow.history.pushState({}, '', '/t/4242');
fakeDocument.setTopicReplies([new FakeNativeReply('fresh-page-1', 32, 'FreshPage1')], 1);
assert(runtime.navigationRevision === 2, 'case 3 did not record both page transitions');
assert(!isCurrentTopic(stalePage1Topic), 'case 3 revived an obsolete page-1 snapshot after ABA navigation');
assert(!topicStateMatchesLocation(), 'case 3 would skip synchronization for an obsolete same-URL snapshot');
assert(scheduledCallbacks.length === 1, 'case 3 did not coalesce navigation synchronization');
scheduledCallbacks.shift()();
await Promise.resolve();
await Promise.resolve();
assert(runtime.topic && runtime.topic !== stalePage1Topic, 'case 3 did not replace the obsolete topic');
assert(isCurrentTopic(runtime.topic), 'case 3 replacement topic does not match the final page');
assertIds(renderedIds(runtime.topic), ['fresh-page-1'], 'case 3 did not render the final page-1 DOM');
assert(!staleTopicHost.contains(stalePage1Topic.threadedView), 'case 3 retained the obsolete threaded container');
assert(stalePage1Topic.nativeReplies.every((element) => !element.classList.contains('wt-v2ex-native-hidden')), 'case 3 did not restore native replies during cleanup');
assert(stalePage1Topic.nativeReplies.every((element) => !element.hasAttribute('aria-hidden')), 'case 3 left stale native aria-hidden state');

// Case 4: the real page loader lifecycle must reject delayed old-page results.
runtime.navigationRevision = 10;
runtime.navigationSchedule = 0;
setLocation(1);
runtime.observedTopicKey = topicContext().key;
const delayedTopic = lifecycleTopic(1);
runtime.topic = delayedTopic;
const originalReplies = delayedTopic.allReplies;
let releasePageLoader;
const pageLoaderGate = new Promise((resolve) => { releasePageLoader = resolve; });
const delayedLoad = loadAllTopicPages(delayedTopic, async (_topic, pages, onProgress) => {
  await pageLoaderGate;
  onProgress(pages.length, pages.length);
  return [{ page: 2, replies: [reply('delayed-page-2', 51, 2, 'Delayed')] }];
});
assert(delayedTopic.loading, 'case 4 did not enter the loading state');
fakeWindow.history.pushState({}, '', '?p=2');
const activePage2Topic = topicSnapshot(2);
runtime.topic = activePage2Topic;
releasePageLoader();
await delayedLoad;
assert(delayedTopic.loading === false, 'case 4 did not settle the orphaned loading state');
assert(delayedTopic.allReplies === originalReplies && delayedTopic.allReplies.length === 1, 'case 4 merged a delayed result into the old topic');
assert(!delayedTopic.loadedPages.has(2), 'case 4 marked a delayed page as loaded');
assert(runtime.topic === activePage2Topic, 'case 4 replaced the active topic with stale state');
assert(isCurrentTopic(runtime.topic), 'case 4 invalidated the new page-2 snapshot');

// Original mode restores every native reply and repeated mode changes only toggle state.
topic.currentPage = 2;
topic.visibleThread = page2;
topic.view = 'original';
renderThreadedView(topic);
applyTopicView(topic, 'threaded');
assert(topic.nativeReplies.every((element) => element.classList.contains('wt-v2ex-native-hidden')), 'threaded mode did not hide native replies');
assert(topic.nativeReplies.every((element) => element.getAttribute('aria-hidden') === 'true'), 'threaded mode did not mark native replies hidden');
applyTopicView(topic, 'original');
applyTopicView(topic, 'original');
assert(topic.threadedView.hidden, 'original mode did not hide the threaded projection');
assert(topic.nativeReplies.every((element) => !element.classList.contains('wt-v2ex-native-hidden')), 'original mode left native replies hidden');
assert(topic.nativeReplies.every((element) => !element.hasAttribute('aria-hidden')), 'original mode left stale aria-hidden attributes');

const cyclic = deriveVisibleThread({
  currentPage: 2,
  models: [
    { id: 'cycle-a', floor: 20, page: 2, parentId: 'cycle-b' },
    { id: 'cycle-b', floor: 10, page: 1, parentId: 'cycle-a' }
  ]
});
assert(cyclic.visibleIds.size === 2, 'ancestor cycle guard failed');
assert(cyclic.roots.length === 1 && cyclic.roots[0].id === 'cycle-a', 'cycle projection did not retain a renderable root');

const snapshotRevision = runtime.navigationRevision;
const snapshotProbe = {
  key: 'https://www.v2ex.com/t/42?p=2',
  currentPage: 2,
  navigationRevision: snapshotRevision
};
assert(topicSnapshotMatches(snapshotProbe, { key: snapshotProbe.key, page: 2 }), 'matching topic snapshot was rejected');
assert(!topicSnapshotMatches(snapshotProbe, { key: snapshotProbe.key, page: 2 }, snapshotRevision + 1), 'stale navigation revision was accepted');
assert(!topicSnapshotMatches(snapshotProbe, { key: 'https://www.v2ex.com/t/42?p=1', page: 1 }), 'stale page snapshot was accepted');
assert(!topicSnapshotMatches(snapshotProbe, { key: 'https://www.v2ex.com/t/43?p=2', page: 2 }), 'stale topic snapshot was accepted');

fakeDocument.setCurrentPageMarker(2);
assert(topicDomMatchesContext({ page: 2 }), 'matching native page marker was rejected');
fakeDocument.setCurrentPageMarker(1);
assert(!topicDomMatchesContext({ page: 2 }), 'old native DOM was accepted under the new page URL');
fakeDocument.setCurrentPageMarker(null);
assert(topicDomMatchesContext({ page: 2 }), 'single-page topic without a page marker was rejected');

fakeDocument.documentElement.dataset = {};
assert(claimInitialization(), 'initialization claim failed on first execution');
assert(!claimInitialization(), 'initialization claim succeeded more than once');

console.log('threaded pagination lifecycle regression checks passed');
