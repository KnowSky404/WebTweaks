import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./page-tools.user.js', import.meta.url), 'utf8');
assert.match(source, /@version\s+1\.2\.0/);
for (const api of ['GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_setClipboard']) {
  assert.ok(source.includes('// @grant        ' + api));
}
assert.ok(!source.includes('// @grant        none'));

function fixture(pathname, { reducedMotion = false, clipboardError = false } = {}) {
  const copied = [], alerts = [], scrolls = [], frames = [];
  const menus = new Map(), events = new Map();
  const metrics = { registered: 0, unregistered: 0 };
  let clock = 100000, observer, observerOptions, nextId = 0;
  const descend = (node) => [node, ...node.children.flatMap(descend)];
  class Element {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.attrs = attrs;
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();
      this.textContent = '';
    }
    get isConnected() {
      return this === document.body || this === document.head || this.parentElement?.isConnected || false;
    }
    appendChild(node) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
      return node;
    }
    remove() {
      if (!this.parentElement) return;
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
    getAttribute(key) { return this.attrs[key] ?? null; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(event, fn) { this.listeners.set(event, fn); }
    click() { this.listeners.get('click')?.(); }
    matches(selector) {
      if (selector === 'a[href]') return this.tagName === 'A' && !!this.getAttribute('href');
      if (selector.includes('role="row"')) return this.getAttribute('role') === 'row' || this.tagName === 'TR';
      if (selector.includes('/blob/')) return this.tagName === 'A' && (this.getAttribute('href') || '').includes('/blob/');
      if (selector.includes('raw-button')) return this.tagName === 'A' && (
        this.getAttribute('data-testid') === 'raw-button' ||
        (this.getAttribute('href') || '').includes('/raw/') ||
        (this.getAttribute('href') || '').includes('raw.githubusercontent.com/')
      );
      return false;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    querySelector(selector) { return descend(this).find((node) => node !== this && node.matches(selector)) || null; }
    querySelectorAll(selector) { return descend(this).filter((node) => node !== this && node.matches(selector)); }
  }
  const document = {
    body: new Element('body'), head: new Element('head'),
    createElement: (tag) => new Element(tag),
    getElementById(key) { return [...descend(this.body), ...descend(this.head)].find((node) => node.id === key) || null; },
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
    addEventListener(event, fn) { events.set(event, fn); },
  };
  const list = document.body.appendChild(new Element('div', { role: 'table' }));
  const location = { pathname, href: 'https://github.com' + pathname };
  const window = {
    matchMedia: () => ({ matches: reducedMotion }),
    scrollTo: (args) => scrolls.push(args),
    alert: (msg) => alerts.push(msg),
    requestAnimationFrame: (fn) => frames.push(fn),
    addEventListener: (event, fn) => events.set(event, fn),
  };
  class MutationObserver {
    constructor(callback) { observer = callback; }
    observe(_node, options) { observerOptions = options; }
  }
  runInNewContext(source, {
    document, location, window, MutationObserver, URL, Date: { now: () => clock },
    GM_registerMenuCommand(name, callback) {
      const id = ++nextId;
      menus.set(id, { name, callback });
      metrics.registered++;
      return id;
    },
    GM_unregisterMenuCommand(id) {
      assert.ok(menus.delete(id));
      metrics.unregistered++;
    },
    GM_setClipboard(url, type) {
      if (clipboardError) throw Error('clipboard denied');
      assert.equal(type, 'text');
      copied.push(url);
    },
  });
  function flush() { while (frames.length) frames.shift()(); }
  return {
    document, location, window, list, copied, alerts, scrolls, menus, metrics, observerOptions,
    row(href, iconOutside = false) {
      const row = list.appendChild(new Element('div', { role: 'row' }));
      const anchor = row.appendChild(new Element('a', { href }));
      const text = anchor.appendChild(new Element('span'));
      const icon = iconOutside ? row.appendChild(new Element('span')) : anchor.appendChild(new Element('span'));
      return { row, anchor, text, icon };
    },
    raw(href) {
      const link = document.body.appendChild(new Element('a', { href, 'data-testid': 'raw-button' }));
      link.textContent = 'Raw';
      observer([{ type: 'childList', addedNodes: [link], removedNodes: [] }]);
      flush();
      return link;
    },
    rightClick(target) { events.get('contextmenu')?.({ target }); },
    copy() { [...menus.values()][0]?.callback(); },
    top() { document.getElementById('wt-gh-scroll-top').click(); },
    refresh() {
      events.get('turbo:render')?.();
      observer([{ type: 'childList', addedNodes: [list], removedNodes: [] }]);
      flush();
    },
    navigate(path) {
      location.pathname = path;
      location.href = 'https://github.com' + path;
      events.get('turbo:load')?.();
      flush();
    },
    changeHref(anchor, href) {
      const oldValue = anchor.getAttribute('href');
      anchor.setAttribute('href', href);
      observer([{ type: 'attributes', target: anchor, oldValue }]);
      flush();
    },
    advance(ms) { clock += ms; },
  };
}

const rawHost = 'https://raw.githubusercontent.com';

// Copy right-clicked package.json from the repository root and preserve scroll-to-top.
{
  const f = fixture('/alice/widgets');
  const file = f.row('/alice/widgets/blob/main/package.json');
  assert.equal(f.menus.size, 1);
  assert.equal([...f.menus.values()][0].name, '复制右键文件的 Raw 链接');
  f.rightClick(file.text);
  f.copy();
  assert.deepEqual(f.copied, [rawHost + '/alice/widgets/main/package.json']);
  f.top();
  assert.deepEqual(f.scrolls[0].top, 0);
  assert.equal(f.scrolls[0].behavior, 'smooth');
  f.refresh();
  assert.equal(f.metrics.registered, 1);
  assert.equal(f.document.getElementById('wt-gh-copy-raw-url'), null);
}

// Nested path, explicit slash-containing branch ref, icon outside the file link.
{
  const f = fixture('/alice/widgets/tree/feature/ui/src');
  const file = f.row('/alice/widgets/blob/refs/heads/feature/ui/src/package.json', true);
  f.rightClick(file.icon);
  f.copy();
  assert.deepEqual(f.copied, [rawHost + '/alice/widgets/refs/heads/feature/ui/src/package.json']);
  const folder = f.row('/alice/widgets/tree/refs/heads/feature/ui/src/widgets');
  f.rightClick(folder.text);
  f.copy();
  assert.equal(f.copied.length, 1);
  assert.equal(f.alerts.length, 1);
}

// Reject other hosts/repositories, directory links, and non-file anchors.
{
  const f = fixture('/alice/widgets');
  for (const href of [
    '/other/repo/blob/main/file.txt',
    'https://example.com/alice/widgets/blob/main/file.txt',
    '/alice/widgets/tree/main/src',
    '/alice/widgets/blob/main',
    'https://github.com/',
  ]) {
    const link = f.row(href);
    f.rightClick(link.text);
    f.copy();
  }
  assert.equal(f.copied.length, 0);
  assert.equal(f.alerts.length, 5);
}

// Clear right-click context on a different target, removed link, navigation, or age.
{
  const f = fixture('/alice/widgets');
  const file = f.row('/alice/widgets/blob/main/package.json');
  f.rightClick(file.text);
  f.rightClick(f.list);
  f.copy();
  assert.equal(f.copied.length, 0);
  f.rightClick(file.text);
  file.row.remove();
  f.copy();
  assert.equal(f.copied.length, 0);
  const second = f.row('/alice/widgets/blob/main/LICENSE');
  f.rightClick(second.text);
  f.navigate('/alice/widgets/issues');
  assert.equal(f.menus.size, 0);
  f.navigate('/alice/widgets');
  f.copy();
  assert.equal(f.copied.length, 0);
  f.rightClick(second.text);
  f.advance(61000);
  f.copy();
  assert.equal(f.copied.length, 0);
}

// On file detail pages normalize the native github.com/raw link to raw.githubusercontent.com.
{
  const f = fixture('/alice/widgets/blob/main/package.json');
  f.raw('/alice/widgets/raw/refs/heads/main/package.json');
  f.copy();
  assert.deepEqual(f.copied, [rawHost + '/alice/widgets/refs/heads/main/package.json']);
  f.navigate('/alice/widgets/blob/feature/ui/src/index.js');
  f.raw('/alice/widgets/raw/refs/heads/feature/ui/src/index.js');
  f.copy();
  assert.equal(f.copied.at(-1), rawHost + '/alice/widgets/refs/heads/feature/ui/src/index.js');
}

// Detect changed file links and preserve reduced-motion scroll preference.
{
  const f = fixture('/alice/widgets', { reducedMotion: true });
  const file = f.row('/alice/widgets/blob/main/package.json');
  f.rightClick(file.text);
  f.changeHref(file.anchor, '/alice/widgets/blob/main/private.txt');
  f.copy();
  assert.equal(f.copied.length, 0);
  f.rightClick(file.text);
  f.copy();
  assert.deepEqual(f.copied, [rawHost + '/alice/widgets/main/private.txt']);
  f.top();
  assert.equal(f.scrolls[0].behavior, 'auto');
}

// Fail closed when the userscript manager denies clipboard writes.
{
  const f = fixture('/alice/widgets', { clipboardError: true });
  const file = f.row('/alice/widgets/blob/main/package.json');
  f.rightClick(file.text);
  f.copy();
  assert.equal(f.copied.length, 0);
  assert.match(f.alerts[0], /复制 Raw 链接失败/);
}

console.log('GitHub Page Tools: 7 fixture groups passed (targeted context, Raw host, navigation, safety, clipboard, scroll).');
