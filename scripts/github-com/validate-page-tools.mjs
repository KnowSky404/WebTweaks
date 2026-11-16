import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./page-tools.user.js', import.meta.url), 'utf8');
assert.match(source, /@version\s+1\.1\.0/);
for (const grant of ['GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_setClipboard']) {
  assert.ok(source.includes('// @grant        ' + grant));
}
assert.ok(!source.includes('// @grant        none'));

function fixture(pathname, href = null, { reducedMotion = false, clipboardThrows = false } = {}) {
  const copied = [];
  const alerts = [];
  const scrollCalls = [];
  const raf = [];
  const menu = new Map();
  const history = { registers: 0, unregisters: 0 };
  const events = new Map();
  let observer;
  let observerOptions;
  let nextId = 0;

  function walk(node) {
    return [node, ...node.children.flatMap(walk)];
  }
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
      return !!this.parentNode || this === document.head || this === document.body;
    }
    appendChild(node) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
      return node;
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    click() { this.listeners.click?.(); }
    matches() {
      return this.tagName === 'A' && (
        this.attributes['data-testid'] === 'raw-button' ||
        (this.attributes.href || '').includes('/raw/') ||
        (this.attributes.href || '').includes('raw.githubusercontent.com/')
      );
    }
    querySelector() { return walk(this).find((node) => node !== this && node.matches()) || null; }
  }
  const document = {
    body: new Element('body'),
    head: new Element('head'),
    createElement: (tag) => new Element(tag),
    getElementById(id) { return [...walk(this.body), ...walk(this.head)].find((node) => node.id === id) || null; },
    querySelectorAll() { return walk(this.body).filter((node) => node.matches()); },
    addEventListener: (event, callback) => events.set(event, callback),
  };
  const toolbar = document.body.appendChild(new Element('div'));
  function addRaw(value) {
    if (!value) return null;
    const link = new Element('a');
    link.textContent = 'Raw';
    link.setAttribute('data-testid', 'raw-button');
    link.setAttribute('href', value);
    toolbar.appendChild(link);
    return link;
  }
  let raw = addRaw(href);
  const location = { pathname, href: 'https://github.com' + pathname };
  const window = {
    matchMedia: () => ({ matches: reducedMotion }),
    scrollTo: (options) => scrollCalls.push(options),
    alert: (message) => alerts.push(message),
    requestAnimationFrame: (callback) => raf.push(callback),
    addEventListener: (event, callback) => events.set(event, callback),
  };
  class MutationObserver {
    constructor(callback) { observer = callback; }
    observe(_node, options) { observerOptions = options; }
  }
  runInNewContext(source, {
    document, location, window, URL, MutationObserver,
    GM_registerMenuCommand(label, callback) {
      const id = 'cmd-' + ++nextId;
      menu.set(id, { label, callback });
      history.registers++;
      return id;
    },
    GM_unregisterMenuCommand(id) {
      assert.ok(menu.delete(id), 'unregister a known id');
      history.unregisters++;
    },
    GM_setClipboard(value, type) {
      if (clipboardThrows) throw Error('blocked');
      assert.equal(type, 'text');
      copied.push(value);
    },
  });
  function flush() { while (raf.length) raf.shift()(); }
  function rawMutation(added, removed) {
    observer([{ type: 'childList', addedNodes: added, removedNodes: removed }]);
    flush();
  }
  return {
    document, menu, copied, alerts, scrollCalls, history, observerOptions,
    get callback() { return [...menu.values()][0]?.callback; },
    copy() { this.callback?.(); },
    top() { document.getElementById('wt-gh-scroll-top')?.click(); },
    refresh() {
      events.get('turbo:render')?.();
      events.get('pjax:end')?.();
      observer([{ type: 'childList', addedNodes: [toolbar], removedNodes: [] }]);
      flush();
    },
    navigate(path, nextRaw) {
      location.pathname = path;
      location.href = 'https://github.com' + path;
      const old = raw;
      old?.remove();
      raw = addRaw(nextRaw);
      events.get('turbo:load')?.();
      rawMutation(raw ? [raw] : [], old ? [old] : []);
    },
    setRaw(nextRaw) {
      const old = raw;
      old?.remove();
      raw = addRaw(nextRaw);
      rawMutation(raw ? [raw] : [], old ? [old] : []);
    },
    updateHref(nextRaw) {
      const oldValue = raw.getAttribute('href');
      raw.setAttribute('href', nextRaw);
      observer([{ type: 'attributes', target: raw, oldValue }]);
      flush();
    },
    detachRawBeforeObserver() { raw?.remove(); },
  };
}

const file = '/alice/widgets/blob/feature/ui/src/index.js';
const raw = '/alice/widgets/raw/refs/heads/feature/ui/src/index.js';

// One menu entry, original Raw link unmodified, scroll button unchanged.
{
  const f = fixture(file, raw);
  assert.equal(f.menu.size, 1);
  assert.equal([...f.menu.values()][0].label, '复制当前文件的 Raw 链接');
  assert.equal(f.document.getElementById('wt-gh-copy-raw-url'), null);
  f.copy();
  assert.deepEqual(f.copied, ['https://github.com' + raw]);
  f.top();
  assert.equal(f.scrollCalls[0].top, 0);
  assert.equal(f.scrollCalls[0].behavior, 'smooth');
  f.refresh();
  assert.equal(f.history.registers, 1);
  assert.equal(f.document.body.children.length, 2);
}

// Soft navigation both registers and unregisters; an old callback cannot copy.
{
  const f = fixture('/alice/widgets/issues', raw, { reducedMotion: true });
  assert.equal(f.menu.size, 0);
  f.top();
  assert.equal(f.scrollCalls[0].behavior, 'auto');
  f.navigate(file, raw);
  const previous = f.callback;
  assert.equal(f.menu.size, 1);
  f.navigate('/alice/widgets/tree/main', null);
  assert.equal(f.menu.size, 0);
  assert.equal(f.history.unregisters, 1);
  previous();
  assert.equal(f.copied.length, 0);
  assert.equal(f.alerts.length, 1);
  f.navigate(file, raw);
  f.copy();
  assert.deepEqual(f.copied, ['https://github.com' + raw]);
}

// Malicious, cross-repo, wrong-file and stale links do not create a menu command.
{
  const f = fixture(file, 'https://example.com/alice/widgets/raw/feature/ui/src/index.js');
  assert.equal(f.menu.size, 0);
  f.setRaw('/other/repo/raw/feature/ui/src/index.js');
  assert.equal(f.menu.size, 0);
  f.setRaw('/alice/widgets/raw/refs/heads/main/src/index.js');
  assert.equal(f.menu.size, 0);
  f.setRaw('https://raw.githubusercontent.com/alice/widgets/refs/heads/feature/ui/src/index.js');
  f.copy();
  assert.deepEqual(f.copied, ['https://raw.githubusercontent.com/alice/widgets/refs/heads/feature/ui/src/index.js']);
  f.updateHref('https://raw.githubusercontent.com/alice/widgets/main/src/index.js');
  assert.equal(f.menu.size, 0);
  f.updateHref('https://raw.githubusercontent.com/alice/widgets/feature/ui/src/index.js');
  assert.equal(f.menu.size, 1);
}

// Async Raw toolbar insertion/removal; recheck the link at the moment of invocation.
{
  const f = fixture(file);
  assert.equal(f.menu.size, 0);
  f.setRaw(raw);
  const callback = f.callback;
  f.detachRawBeforeObserver();
  callback();
  assert.equal(f.copied.length, 0);
  assert.equal(f.alerts.length, 1);
  f.setRaw(null);
  assert.equal(f.menu.size, 0);
  assert.equal(f.observerOptions.attributeOldValue, true);
}

// Privileged clipboard failures report an error rather than a false success.
{
  const f = fixture(file, raw, { clipboardThrows: true });
  f.copy();
  assert.equal(f.copied.length, 0);
  assert.match(f.alerts[0], /复制 Raw 链接失败/);
}

console.log('GitHub Page Tools: 5 fixture scenarios passed (menu, clipboard, SPA, URL safety, scroll).');
