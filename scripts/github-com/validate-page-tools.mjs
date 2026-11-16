import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./page-tools.user.js', import.meta.url), 'utf8');

function makeFixture(pathname, rawHref = null, { reducedMotion = false } = {}) {
  const raf = [];
  const copied = [];
  const scrollCalls = [];
  const handlers = new Map();
  let observerCallback;

  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.parentNode = null;
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.textContent = '';
    }
    get isConnected() {
      return this === document.body || this === document.head || !!this.parentNode?.isConnected;
    }
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      return siblings[siblings.indexOf(this) - 1] || null;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { return this.listeners.click?.(); }
    appendChild(node) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
      return node;
    }
    insertAdjacentElement(where, node) {
      assert.equal(where, 'afterend');
      node.remove();
      const siblings = this.parentNode.children;
      siblings.splice(siblings.indexOf(this) + 1, 0, node);
      node.parentNode = this.parentNode;
    }
    remove() {
      if (!this.parentNode) return;
      const siblings = this.parentNode.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    }
    matches(selector) {
      return this.tagName === 'A' && selector.includes('raw-button') &&
        (this.getAttribute('data-testid') === 'raw-button' || (this.getAttribute('href') || '').includes('/raw/'));
    }
    querySelector(selector) {
      return walk(this).find((node) => node !== this && node.matches(selector)) || null;
    }
  }
  function walk(root) {
    return [root, ...root.children.flatMap(walk)];
  }
  const document = {
    body: new Element('body'),
    head: new Element('head'),
    createElement(tag) { return new Element(tag); },
    getElementById(id) {
      return [...walk(this.body), ...walk(this.head)].find((element) => element.id === id) || null;
    },
    querySelectorAll(selector) {
      return walk(this.body).filter((node) => node.tagName === 'A' && node.matches(selector));
    },
    addEventListener(event, callback) { handlers.set(event, callback); },
  };
  const toolbar = new Element('div');
  document.body.appendChild(toolbar);
  function makeRawLink(href) {
    const link = new Element('a');
    link.textContent = 'Raw';
    link.setAttribute('href', href);
    link.setAttribute('data-testid', 'raw-button');
    toolbar.appendChild(link);
    return link;
  }
  let rawLink = rawHref ? makeRawLink(rawHref) : null;
  const location = { pathname, href: `https://github.com${pathname}` };
  const window = {
    matchMedia: () => ({ matches: reducedMotion }),
    scrollTo: (arg) => scrollCalls.push(arg),
    requestAnimationFrame: (callback) => raf.push(callback),
    setTimeout: () => 0,
    addEventListener: (event, callback) => handlers.set(event, callback),
  };
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  runInNewContext(source, {
    document,
    window,
    location,
    navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
    MutationObserver,
    URL,
  });

  return {
    document, copied, scrollCalls,
    get rawLink() { return rawLink; },
    clickCopy: () => document.getElementById('wt-gh-copy-raw-url')?.click(),
    clickTop: () => document.getElementById('wt-gh-scroll-top')?.click(),
    changePage(nextPath, nextRawHref) {
      location.pathname = nextPath;
      location.href = `https://github.com${nextPath}`;
      rawLink?.remove();
      rawLink = nextRawHref ? makeRawLink(nextRawHref) : null;
      handlers.get('turbo:load')?.();
      while (raf.length) raf.shift()();
    },
    refreshMultipleTimes() {
      handlers.get('turbo:render')?.();
      handlers.get('pjax:end')?.();
      observerCallback([{ addedNodes: [rawLink].filter(Boolean) }]);
      while (raf.length) raf.shift()();
    },
  };
}

const file = '/alice/widgets/blob/feature/ui/src/index.js';
const raw = '/alice/widgets/raw/refs/heads/feature/ui/src/index.js';

{
  const fixture = makeFixture(file, raw);
  assert.equal(fixture.document.getElementById('wt-gh-scroll-top')?.textContent, '↑');
  assert.equal(fixture.document.getElementById('wt-gh-copy-raw-url')?.textContent, 'Copy Raw URL');
  await fixture.clickCopy();
  assert.deepEqual(fixture.copied, [`https://github.com${raw}`]);
  fixture.clickTop();
  assert.equal(fixture.scrollCalls.length, 1);
  assert.equal(fixture.scrollCalls[0].top, 0);
  assert.equal(fixture.scrollCalls[0].behavior, 'smooth');
  fixture.refreshMultipleTimes();
  assert.equal(fixture.document.body.children.length, 2, 'toolbar and one scroll control');
  assert.equal(fixture.rawLink.parentNode.children.length, 2, 'one native Raw and one copy control');
}

{
  const fixture = makeFixture('/alice/widgets/tree/main/src', raw, { reducedMotion: true });
  assert.equal(fixture.document.getElementById('wt-gh-copy-raw-url'), null, 'no copy action outside file pages');
  fixture.clickTop();
  assert.equal(fixture.scrollCalls[0].behavior, 'auto');
  fixture.changePage(file, raw);
  await fixture.clickCopy();
  assert.deepEqual(fixture.copied, [`https://github.com${raw}`]);
  fixture.changePage('/alice/widgets/issues', null);
  assert.equal(fixture.document.getElementById('wt-gh-copy-raw-url'), null, 'copy control removed after leaving file page');
}

{
  const fixture = makeFixture(file, 'https://example.com/alice/widgets/raw/main/file.js');
  assert.equal(fixture.document.getElementById('wt-gh-copy-raw-url'), null, 'no third-party raw targets');
  fixture.changePage(file, '/other/repo/raw/main/file.js');
  assert.equal(fixture.document.getElementById('wt-gh-copy-raw-url'), null, 'no cross-repository raw targets');
  fixture.changePage(file, 'https://raw.githubusercontent.com/alice/widgets/main/src/index.js');
  await fixture.clickCopy();
  assert.deepEqual(fixture.copied, ['https://raw.githubusercontent.com/alice/widgets/main/src/index.js']);
}

console.log('GitHub Page Tools: 3 fixture scenarios passed (copy, navigation, idempotency, reduced motion, URL safety).');
