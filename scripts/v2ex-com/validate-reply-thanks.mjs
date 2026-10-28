import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Network/state-machine checks use a deliberately small DOM double. The HTML
// fixture separately checks the browser DOM; neither exercises a live account.
const scriptPath = new URL('./conversation-enhancer.user.js', import.meta.url);
const source = await readFile(scriptPath, 'utf8');
const marker = '\n  initialize();\n})();';
const instrumented = source.replace(marker, `
  globalThis.__thanksTest = {
    runtime, readReplyThanks, validThanksToken, thanksSession,
    thanksSourceUrl, rememberThanks, reconcileThanks, updateThanksControl,
    sendReplyThanks, refreshReplyThanks, synchronizeNativeThanks, disposeThanks
  };
})();`);
assert.notEqual(instrumented, source, 'userscript test hook marker not found');

class NativeNode {
  constructor(tag = 'div', attributes = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.parentElement = null;
    this.ownText = text;
    this.dataset = {};
    this.isConnected = true;
    this.hidden = false;
    this.disabled = false;
    this.classList = {
      contains: (token) => (this.getAttribute('class') || '').split(/\s+/).includes(token),
      add: (token) => this.setAttribute('class', [...new Set([...(this.getAttribute('class') || '').split(/\s+/).filter(Boolean), token])].join(' '))
    };
  }

  get id() { return this.getAttribute('id') || ''; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) {
    children.forEach((child) => { child.parentElement = this; this.children.push(child); });
  }

  matches(selector) {
    return selector.split(',').some((part) => {
      const candidate = part.trim();
      const space = candidate.lastIndexOf(' ');
      if (space !== -1) {
        const descendant = candidate.slice(space + 1);
        const ancestor = candidate.slice(0, space);
        return this.matches(descendant) && Boolean(this.parentElement?.closest(ancestor));
      }
      const tag = candidate.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = candidate.match(/^#([\w-]+)/)?.[1];
      if (id && this.id !== id) return false;
      if ([...candidate.matchAll(/\.([\w-]+)/g)].some((match) => !this.classList.contains(match[1]))) return false;
      for (const match of candidate.matchAll(/\[([\w-]+)(?:(\^?=)["']?([^"'\]]*)["']?)?\]/g)) {
        const value = this.getAttribute(match[1]);
        if (value === null) return false;
        if (match[2] === '=' && value !== match[3]) return false;
        if (match[2] === '^=' && !value.startsWith(match[3])) return false;
      }
      return Boolean(tag || id || candidate.startsWith('.') || candidate.startsWith('['));
    });
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => node.children.forEach((child) => {
      if (child.matches(selector)) result.push(child);
      visit(child);
    });
    visit(this);
    return result;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function nativeReply(id, options = {}) {
  const cell = new NativeNode('div', { id: 'r_' + id, class: 'cell' });
  const header = new NativeNode('span', { class: 'fr' });
  const content = new NativeNode('div', { class: 'reply_content' }, 'fixture reply');
  cell.append(header, content);
  if (options.canThank !== false || options.thanked || options.inContent) {
    const area = new NativeNode('span', {
      id: 'thank_area_' + id,
      class: 'thank_area' + (options.thanked ? ' thanked' : '')
    });
    if (options.thanked) area.textContent = '感谢已发送';
    else area.append(new NativeNode('a', { href: '#', onclick: `if (confirm('fixture')) { thankReply(${options.actionId || id}); } return false;` }, '感谢'));
    (options.inContent ? content : header).append(area);
  }
  if (options.count !== null && options.count !== undefined) {
    const count = new NativeNode('span', { class: 'small fade' }, String(options.count));
    count.append(new NativeNode('img', { alt: '❤️' }));
    (options.countInContent ? content : header).append(count);
  }
  return cell;
}

function sourceDocument(page, replies) {
  const document = new NativeNode('document');
  const main = new NativeNode('main', { id: 'Main' });
  const pagination = new NativeNode('div', { class: 'ps_container' });
  pagination.append(new NativeNode('span', { class: 'page_current' }, String(page)));
  main.append(pagination, ...replies.map((reply) => nativeReply(reply.id, reply)));
  document.append(main);
  return document;
}

const response = (data, extra = {}) => ({
  ok: true,
  status: 200,
  url: '',
  json: async () => data,
  text: async () => JSON.stringify(data),
  ...extra
});
const settle = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

function harness(options = {}) {
  const location = { href: 'https://www.v2ex.com/t/42?p=2', origin: 'https://www.v2ex.com', pathname: '/t/42' };
  const timers = new Map();
  let nextTimer = 0;
  const replies = options.replies || [{ id: '201', floor: 101, page: 2, author: 'Fixture', count: 3 }];
  const serverReplies = replies.map((reply) => ({ ...reply }));
  const nativeCells = replies.filter((reply) => reply.page === 2).map((reply) => nativeReply(reply.id, reply));
  const calls = [];
  const confirmations = [];
  let confirmed = true;
  let moneyRefreshes = 0;
  const page = { once: 1000, thankReply() {}, refreshMoney() { moneyRefreshes += 1; } };
  const document = sourceDocument(2, []);
  const defaultFetch = async (input, settings = {}) => {
    const url = new URL(input, location.href);
    if (settings.method === 'POST') {
      const id = url.pathname.match(/^\/thank\/reply\/(\d+)$/)?.[1];
      assert(id, 'unexpected write endpoint');
      const target = serverReplies.find((reply) => reply.id === id);
      assert(target, 'write addressed an unrelated reply');
      target.thanked = true;
      target.count = Number(target.count || 0) + 1;
      return response({ success: true, once: 1001 });
    }
    return response({ page: Number(url.searchParams.get('p') || 1), replies: serverReplies.filter((reply) => reply.page === Number(url.searchParams.get('p') || 1)) }, { url: url.href });
  };
  let fetchImpl = defaultFetch;
  const window = {
    confirm(message) { confirmations.push(message); return confirmed; },
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  class FakeDOMParser {
    parseFromString(text) {
      const snapshot = JSON.parse(text);
      return sourceDocument(snapshot.page, snapshot.replies);
    }
  }
  const sandbox = {
    console, URL, AbortController, document, location, window, unsafeWindow: page,
    Element: NativeNode,
    DOMParser: FakeDOMParser,
    fetch(input, settings) {
      calls.push({ url: String(input), settings });
      return fetchImpl(input, settings);
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(instrumented, sandbox, { filename: scriptPath.pathname });
  const api = sandbox.__thanksTest;
  const models = replies.map((reply) => ({ ...reply, thanks: api.readReplyThanks(nativeReply(reply.id, reply), reply.id) }));
  const topic = {
    context: { id: '42', page: 2, key: 'https://www.v2ex.com/t/42?p=2' },
    key: 'https://www.v2ex.com/t/42?p=2', currentPage: 2, navigationRevision: 0,
    allReplies: models, nativeReplies: nativeCells, thanksReads: new Set(),
    threadedView: new NativeNode('section')
  };
  api.runtime.topic = topic;
  return {
    api, topic, models, nativeCells, page, location, timers, calls, confirmations, serverReplies, defaultFetch,
    setFetch(value) { fetchImpl = value; },
    confirm(value) { confirmed = value; },
    get moneyRefreshes() { return moneyRefreshes; },
    posts() { return calls.filter((call) => call.settings?.method === 'POST'); }
  };
}

const cases = [];
const check = (name, callback) => cases.push({ name, callback });

check('parsing scopes counts and capability to each native reply header', () => {
  const { api } = harness();
  assert.equal(api.readReplyThanks(nativeReply('201', { count: '1,234' }), '201').count, 1234);
  assert.equal(api.readReplyThanks(nativeReply('201', { count: 0 }), '201').count, 0);
  assert.equal(api.readReplyThanks(nativeReply('201', { count: 'unknown' }), '201').count, null);
  assert.equal(api.readReplyThanks(nativeReply('201', { count: 9, countInContent: true }), '201').count, null);
  assert.equal(api.readReplyThanks(nativeReply('201', { count: 3 }), '201').canThank, true);
  assert.equal(api.readReplyThanks(nativeReply('201', { actionId: '202' }), '201').canThank, false);
  assert.equal(api.readReplyThanks(nativeReply('201', { inContent: true }), '201').canThank, false);
  assert.equal(api.readReplyThanks(nativeReply('201', { canThank: false }), '201').canThank, false);
  const thanked = api.readReplyThanks(nativeReply('201', { thanked: true, count: 3 }), '201');
  assert.equal(thanked.thanked, true);
  assert.equal(thanked.canThank, false);
  assert.equal(api.readReplyThanks(nativeReply('fallback-1', {}), 'fallback-1').canThank, false);
});

check('token validation and page capability fail closed', () => {
  const h = harness();
  for (const invalid of [undefined, null, {}, true, -1, NaN, Infinity, '1e3', ' 123 ', '123.4']) assert.equal(h.api.validThanksToken(invalid), false);
  assert.equal(h.api.validThanksToken('123'), true);
  assert.equal(h.api.validThanksToken(123), true);
  assert.equal(h.api.thanksSession().token, 1000);
  h.page.once = undefined;
  assert.equal(h.api.thanksSession(), null);
  h.page.once = 1000;
  h.page.thankReply = undefined;
  assert.equal(h.api.thanksSession(), null);
});

check('cancel, cross-page replies and missing native actions never send writes', async () => {
  const h = harness({ replies: [
    { id: '201', floor: 101, page: 2, author: 'Fixture', count: 3 },
    { id: '102', floor: 2, page: 1, author: 'Ancestor', count: 2 },
    { id: '204', floor: 104, page: 2, author: 'Self', count: null, canThank: false }
  ] });
  h.confirm(false);
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0], /10/);
  assert.equal(h.models[0].thanks.phase, 'idle');
  h.confirm(true);
  await h.api.sendReplyThanks(h.topic, h.models[1]);
  await h.api.sendReplyThanks(h.topic, h.models[2]);
  h.page.once = undefined;
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  assert.equal(h.posts().length, 0);
  const url = new URL(h.api.thanksSourceUrl(h.topic, h.models[1]));
  assert.equal(url.origin, h.location.origin);
  assert.equal(url.pathname, '/t/42');
  assert.equal(Number(url.searchParams.get('p') || '1'), 1);
  assert.equal(url.hash, '#wt-v2ex-thank-102');
});

check('success uses the real reply ID and live token and synchronizes confirmed state', async () => {
  const h = harness();
  h.page.once = 9876;
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  await settle();
  assert.equal(h.posts().length, 1);
  const request = h.posts()[0];
  assert.equal(new URL(request.url).pathname, '/thank/reply/201');
  assert.equal(new URL(request.url).searchParams.get('once'), '9876');
  assert.equal(request.settings.credentials, 'same-origin');
  assert.equal(request.settings.redirect, 'error');
  assert.equal(h.page.once, 1001);
  assert.equal(h.models[0].thanks.thanked, true);
  assert.equal(h.models[0].thanks.count, 4);
  assert.equal(h.nativeCells[0].querySelector('[id]').classList.contains('thanked'), true);
  assert.equal(h.moneyRefreshes, 1);
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  assert.equal(h.posts().length, 1, 'already-thanked reply sent a second write');
});

check('an in-flight write blocks double activation and concurrent thanks', async () => {
  const h = harness({ replies: [
    { id: '201', floor: 101, page: 2, author: 'A', count: 3 },
    { id: '202', floor: 102, page: 2, author: 'B', count: 1 }
  ] });
  let finish;
  h.setFetch((input, options) => options.method === 'POST' ? new Promise((resolve) => { finish = resolve; }) : h.defaultFetch(input, options));
  const pending = h.api.sendReplyThanks(h.topic, h.models[0]);
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  await h.api.sendReplyThanks(h.topic, h.models[1]);
  assert.equal(h.posts().length, 1);
  assert.equal(h.models[0].thanks.phase, 'pending');
  finish(response({ success: true, once: 1001 }));
  await pending;
  await settle();
  assert.equal(h.api.runtime.thanksRequest, null);
});

check('explicit failure remains retryable without optimistic success or count changes', async () => {
  const h = harness();
  h.setFetch(async () => response({ success: false, once: 1002, message: '余额不足' }));
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  assert.equal(h.models[0].thanks.phase, 'idle');
  assert.equal(h.models[0].thanks.thanked, false);
  assert.equal(h.models[0].thanks.count, 3);
  assert.equal(h.models[0].thanks.message, '余额不足');
  assert.equal(h.page.once, 1002);
  assert.equal(h.moneyRefreshes, 0);
  assert.equal(h.posts().length, 1);
});

check('network loss and malformed responses stay unknown without automatic retries', async () => {
  for (const outcome of ['network', 'malformed', 'http']) {
    const h = harness();
    h.setFetch(async () => {
      if (outcome === 'network') throw new TypeError('fixture lost response');
      if (outcome === 'http') return response({}, { ok: false, status: 403 });
      return response({ success: 'true', once: 9999 });
    });
    await h.api.sendReplyThanks(h.topic, h.models[0]);
    assert.equal(h.models[0].thanks.phase, 'unknown', outcome);
    assert.equal(h.models[0].thanks.thanked, false, outcome);
    assert.equal(h.models[0].thanks.count, 3, outcome);
    assert.equal(h.page.once, 1000, outcome);
    await h.api.sendReplyThanks(h.topic, h.models[0]);
    assert.equal(h.posts().length, 1, outcome + ' retried the write');
  }
});

check('timeout aborts transport but keeps an uncertain outcome and releases the request lock', async () => {
  const h = harness();
  h.setFetch((_input, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture timeout'), { name: 'AbortError' })), { once: true });
  }));
  const pending = h.api.sendReplyThanks(h.topic, h.models[0]);
  const timeout = [...h.timers.values()].find((timer) => timer.milliseconds === 12_000);
  assert(timeout, 'write timeout was not scheduled');
  timeout.callback();
  await pending;
  assert.equal(h.posts().length, 1);
  assert.equal(h.models[0].thanks.phase, 'unknown');
  assert.equal(h.api.runtime.thanksRequest, null);
  assert.equal(h.timers.size, 0);
});

check('an uncertain token cannot be reused on another reply until the live native token changes', async () => {
  const h = harness({ replies: [
    { id: '201', floor: 101, page: 2, author: 'A', count: 3 },
    { id: '202', floor: 102, page: 2, author: 'B', count: 1 }
  ] });
  h.setFetch(async (input, options) => {
    if (options.method === 'POST' && new URL(input).pathname === '/thank/reply/201') throw new TypeError('fixture response unknown');
    return h.defaultFetch(input, options);
  });
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  await h.api.sendReplyThanks(h.topic, h.models[1]);
  assert.equal(h.posts().length, 1, 'another reply reused the token from an uncertain request');
  h.page.once = 1001;
  await h.api.sendReplyThanks(h.topic, h.models[1]);
  await settle();
  assert.equal(h.posts().length, 2);
  assert.equal(new URL(h.posts()[1].url).searchParams.get('once'), '1001');
  assert.equal(h.models[1].thanks.thanked, true);
  assert.equal(h.models[0].thanks.phase, 'unknown', 'a new token cleared another reply’s uncertain result');
});

check('readback confirms accepted writes without issuing another POST', async () => {
  const h = harness();
  h.setFetch(async (input, options) => {
    if (options.method === 'POST') {
      h.serverReplies[0].thanked = true;
      h.serverReplies[0].count = 4;
      throw new TypeError('fixture dropped accepted response');
    }
    return h.defaultFetch(input, options);
  });
  await h.api.sendReplyThanks(h.topic, h.models[0]);
  assert.equal(h.models[0].thanks.phase, 'unknown');
  await h.api.refreshReplyThanks(h.topic, h.models[0], true);
  assert.equal(h.models[0].thanks.thanked, true);
  assert.equal(h.models[0].thanks.count, 4);
  assert.equal(h.models[0].thanks.phase, 'idle');
  assert.equal(h.posts().length, 1);
  assert.equal(h.nativeCells[0].querySelector('[id]').classList.contains('thanked'), true);
});

check('negative or redirected readback never re-enables a potentially accepted write', async () => {
  for (const redirect of [false, true]) {
    const h = harness();
    h.models[0].thanks.phase = 'unknown';
    h.api.rememberThanks(h.topic, h.models[0], 'unknown');
    if (redirect) h.setFetch(async () => response({}, { url: 'https://www.v2ex.com/signin' }));
    await h.api.refreshReplyThanks(h.topic, h.models[0], true);
    assert.equal(h.models[0].thanks.phase, 'unknown');
    assert.equal(h.models[0].thanks.thanked, false);
    await h.api.sendReplyThanks(h.topic, h.models[0]);
    assert.equal(h.posts().length, 0);
  }
});

check('native thanks state synchronizes without sending a write', async () => {
  const h = harness();
  h.serverReplies[0].thanked = true;
  h.serverReplies[0].count = 4;
  const area = h.nativeCells[0].querySelector('[id]');
  area.classList.add('thanked');
  area.textContent = '感谢已发送';
  h.api.synchronizeNativeThanks(h.topic);
  await settle();
  assert.equal(h.models[0].thanks.thanked, true);
  assert.equal(h.models[0].thanks.count, 4);
  assert.equal(h.posts().length, 0);
});

check('late results never replace the current page token or mutate its native reply', async () => {
  const h = harness();
  let finish;
  h.setFetch(() => new Promise((resolve) => { finish = resolve; }));
  const pending = h.api.sendReplyThanks(h.topic, h.models[0]);
  const oldTopic = h.topic;
  h.api.runtime.navigationRevision += 1;
  h.location.href = 'https://www.v2ex.com/t/42?p=1';
  const newCell = nativeReply('102', { count: 2 });
  const newReply = { id: '102', page: 1, thanks: h.api.readReplyThanks(newCell, '102') };
  h.api.runtime.topic = {
    context: { id: '42', page: 1 }, key: 'https://www.v2ex.com/t/42?p=1', currentPage: 1,
    navigationRevision: 1, allReplies: [newReply], nativeReplies: [newCell], threadedView: new NativeNode('section')
  };
  h.page.once = 5000;
  finish(response({ success: true, once: 1001 }));
  await pending;
  assert.equal(h.page.once, 5000);
  assert.equal(newReply.thanks.thanked, false);
  assert.equal(newReply.thanks.count, 2);
  assert.equal(newCell.querySelector('[id]').classList.contains('thanked'), false);
  assert.equal(h.moneyRefreshes, 0);
  assert.equal(h.posts().length, 1);
  const revisited = { ...oldTopic, navigationRevision: 2 };
  const staleModel = { id: '201', page: 2, thanks: h.api.readReplyThanks(nativeReply('201', { count: 3 }), '201') };
  h.api.reconcileThanks(revisited, staleModel);
  assert.equal(staleModel.thanks.thanked, true, 'confirmed result was lost on a later same-topic projection');
});

check('a concurrently rotated native once is not overwritten by a late response', async () => {
  const h = harness();
  let finish;
  h.setFetch((input, options) => options.method === 'POST' ? new Promise((resolve) => { finish = resolve; }) : h.defaultFetch(input, options));
  const pending = h.api.sendReplyThanks(h.topic, h.models[0]);
  h.page.once = 8000;
  finish(response({ success: true, once: 1001 }));
  await pending;
  await settle();
  assert.equal(h.page.once, 8000);
  assert.equal(h.models[0].thanks.thanked, true);
});

check('an aborted old-topic request permanently blocks its sent token within the document', async () => {
  const h = harness({ replies: [
    { id: '201', floor: 101, page: 2, author: 'A', count: 3 },
    { id: '102', floor: 2, page: 1, author: 'B', count: 2 }
  ] });
  h.setFetch((_input, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture navigation abort'), { name: 'AbortError' })), { once: true });
  }));
  const pending = h.api.sendReplyThanks(h.topic, h.models[0]);
  const oldTopic = h.topic;
  h.api.runtime.navigationRevision = 1;
  h.location.href = 'https://www.v2ex.com/t/42?p=1';
  const cell = nativeReply('102', { count: 2 });
  const reply = { id: '102', page: 1, floor: 2, author: 'B', thanks: h.api.readReplyThanks(cell, '102') };
  const newTopic = {
    context: { id: '42', page: 1 }, key: 'https://www.v2ex.com/t/42?p=1', currentPage: 1,
    navigationRevision: 1, allReplies: [reply], nativeReplies: [cell],
    threadedView: new NativeNode('section'), thanksReads: new Set()
  };
  h.api.runtime.topic = newTopic;
  h.api.disposeThanks(oldTopic);
  await pending;
  assert.equal(h.page.once, 1000, 'old completion wrote the new page’s global token');
  assert.equal(h.api.thanksSession(), null, 'old-topic abort left its sent token reusable');
  await h.api.sendReplyThanks(newTopic, reply);
  assert.equal(h.posts().length, 1, 'new-page reply reused the uncertain old-page token');

  h.page.once = 2000;
  h.setFetch(async () => { throw new TypeError('fixture second uncertain token'); });
  await h.api.sendReplyThanks(newTopic, reply);
  assert.equal(h.posts().length, 2, 'a genuinely changed native token was not allowed');
  assert.equal(new URL(h.posts()[1].url).searchParams.get('once'), '2000');
  h.page.once = 1000;
  assert.equal(h.api.thanksSession(), null, 'blocking a second token forgot the earlier uncertain token');
  h.page.once = 2000;
  assert.equal(h.api.thanksSession(), null, 'the second uncertain token was not retained');
});

check('native confirmed success remains monotonic when the enhanced request later rejects or fails', async () => {
  for (const outcome of ['reject', 'failure']) {
    const h = harness();
    let finish;
    let fail;
    h.setFetch((input, options) => options.method === 'POST'
      ? new Promise((resolve, reject) => { finish = resolve; fail = reject; })
      : h.defaultFetch(input, options));
    const pending = h.api.sendReplyThanks(h.topic, h.models[0]);
    h.serverReplies[0].thanked = true;
    h.serverReplies[0].count = 4;
    const area = h.nativeCells[0].querySelector('[id]');
    area.classList.add('thanked');
    area.textContent = '感谢已发送';
    h.api.synchronizeNativeThanks(h.topic);
    await settle();
    assert.equal(h.models[0].thanks.thanked, true, 'native success was not observed before the late result');
    if (outcome === 'reject') fail(new TypeError('fixture enhanced response lost after native confirmation'));
    else finish(response({ success: false, once: 1001, message: 'fixture late failure' }));
    await pending;
    assert.equal(h.models[0].thanks.thanked, true, outcome);
    assert.equal(h.models[0].thanks.phase, 'idle', outcome + ' downgraded a confirmed success');
    const rebuilt = { id: '201', page: 2, thanks: h.api.readReplyThanks(nativeReply('201', { count: 3 }), '201') };
    h.api.reconcileThanks(h.topic, rebuilt);
    assert.equal(rebuilt.thanks.thanked, true, outcome + ' lost the confirmed state from the result cache');
    assert.equal(rebuilt.thanks.canThank, false, outcome + ' re-enabled a confirmed successful thanks');
    assert.equal(rebuilt.thanks.phase, 'idle', outcome + ' rebuilt confirmed state as unknown');
    assert.equal(rebuilt.thanks.count, 4, outcome + ' lost the confirmed count during rebuild');
    assert.equal(h.posts().length, 1, outcome + ' sent an extra write');
  }
});

for (const test of cases) {
  await test.callback();
  console.log('PASS ' + test.name);
}
console.log(`reply thanks regression checks passed: ${cases.length} cases (mock DOM and network)`);
