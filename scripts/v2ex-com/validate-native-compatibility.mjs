import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./conversation-enhancer.user.js', import.meta.url), 'utf8');
const marker = '\n  initialize();\n})();';
const instrumented = source.replace(marker, '\n  globalThis.__nativeCompatibilityTest = { runtime, classifyNativeMode, nativeModeFromSettings, wantsLegacyConversation, initializeTopic, readNativeMode, cancelNativeModeCheck, topicContext, isFlatReplyList, disposeTopic, nativeImageInteraction, hasContentAncestor, topicDomMatchesContext, synchronizeTopicPage, refreshConversationPolicy, enhanceLinkedImages, enhanceTextImages };\n})();');
if (instrumented === source) throw new Error('test hook not found');

let checks = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

const officialLabel = { textContent: '楼中楼显示方式' };
const selectedMode = (label, associated = true) => ({
  labels: associated ? [officialLabel] : [],
  selectedIndex: 0,
  options: [{ textContent: label }],
  closest: () => null
});
const settingsDocument = (controls = [], radios = []) => ({
  querySelectorAll(selector) {
    return selector === 'select' ? controls : selector === 'input[type="radio"]:checked' ? radios : [];
  }
});
function setup(stored = {}, options = {}) {
  const writes = [];
  const requests = [];
  const location = { href: 'https://www.v2ex.com/t/42?p=1', origin: 'https://www.v2ex.com', pathname: '/t/42' };
  const sandbox = {
    URL, AbortController, location,
    window: options.window || { setTimeout: () => 1, clearTimeout: () => {} },
    document: options.document || { querySelectorAll() { throw new Error('native policy must not scan the reply DOM'); } },
    MutationObserver: options.MutationObserver,
    Element: options.Element,
    HTMLImageElement: options.HTMLImageElement,
    NodeFilter: options.NodeFilter,
    GM_getValue: () => stored,
    GM_setValue: (key, value) => writes.push({ key, value }),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      return { ok: true, url: 'https://www.v2ex.com/settings', text: async () => 'mock settings' };
    },
    DOMParser: class { parseFromString() { return options.settings || settingsDocument(); } }
  };
  vm.runInNewContext(instrumented, sandbox);
  return { api: sandbox.__nativeCompatibilityTest, writes, requests };
}

{
  const { api, writes } = setup({ version: 3, preferredView: 'threaded', imagePreviewEnabled: false, imageLightboxEnabled: true, scrollTopEnabled: false });
  const settings = api.runtime.settings;
  check(settings.version === 4 && settings.conversationMode === 'auto' && !settings.legacyFallbackEnabled, 'threaded migrated unsafely');
  check(!settings.imagePreviewEnabled && settings.imageLightboxEnabled && !settings.scrollTopEnabled, 'feature choices lost');
  check(writes.length === 1 && !('preferredView' in writes[0].value), 'schema not normalized');
  check(setup({ version: 3, preferredView: 'original' }).api.runtime.settings.conversationMode === 'native', 'original migration');
  check(setup({ version: 4, conversationMode: 'unrecognized', legacyFallbackEnabled: 'true' }).api.runtime.settings.conversationMode === 'auto', 'invalid mode accepted');
  check(!setup({ version: 4, conversationMode: 'unrecognized', legacyFallbackEnabled: 'true' }).api.wantsLegacyConversation(), 'invalid boolean enabled fallback');
  check(api.wantsLegacyConversation({ conversationMode: 'legacy' }), 'explicit legacy');
  check(api.wantsLegacyConversation({ conversationMode: 'auto', legacyFallbackEnabled: true }), 'auto fallback');
  check(!api.wantsLegacyConversation({ conversationMode: 'native', legacyFallbackEnabled: true }), 'native precedence');
  check(!setup().api.wantsLegacyConversation(), 'new installation enabled legacy');
}

{
  const { api } = setup();
  const enhanced = ['引用条', '角标 + 悬浮预览', '楼中楼', '树形缩进', '对话连线', '引用楼层'];
  for (const label of enhanced) {
    check(api.classifyNativeMode(label) === 'enhanced', 'official enhanced mode not detected: ' + label);
    check(api.nativeModeFromSettings(settingsDocument([selectedMode(label)])) === 'enhanced', 'enhanced selected option not detected');
  }
  check(api.classifyNativeMode('经典平铺（默认）') === 'classic', 'classic label');
  check(api.nativeModeFromSettings(settingsDocument([selectedMode('经典平铺')])) === 'classic', 'classic selected option');
  check(api.nativeModeFromSettings(settingsDocument([selectedMode('经典平铺', false)])) === 'unknown', 'unrelated select was accepted');
  check(api.nativeModeFromSettings(settingsDocument([selectedMode('经典平铺'), selectedMode('楼中楼')])) === 'unknown', 'ambiguous setting was accepted');
  check(api.nativeModeFromSettings(settingsDocument([selectedMode('unknown')])) === 'unknown', 'unknown option was accepted');
  check(api.nativeModeFromSettings(settingsDocument()) === 'unknown', 'missing option was accepted');
  const radio = { labels: [{ textContent: '经典平铺' }], closest: () => ({ querySelectorAll: () => [officialLabel] }) };
  check(api.nativeModeFromSettings(settingsDocument([], [radio])) === 'classic', 'associated radio selection');
}

for (const stored of [{}, { version: 4, conversationMode: 'native', legacyFallbackEnabled: true }]) {
  const { api, requests } = setup(stored);
  await api.initializeTopic();
  check(requests.length === 0 && api.runtime.topic === null, 'native policy started conversation network or model');
}

for (const label of ['引用条', '角标 + 悬浮预览', '楼中楼', '树形缩进', '对话连线', '引用楼层', 'unknown']) {
  const { api, requests } = setup({ version: 4, conversationMode: 'legacy' }, { settings: settingsDocument([selectedMode(label)]) });
  await api.initializeTopic();
  check(api.runtime.topic === null && requests.length === 1, 'nonclassic setting started legacy reconstruction');
  check(requests[0].url === 'https://www.v2ex.com/settings' && requests[0].init.credentials === 'same-origin' && requests[0].init.redirect === 'error', 'settings read escaped same origin');
  await api.initializeTopic();
  check(requests.length === 1, 'settings re-read within the same revision');
}

{
  let release;
  const { api, requests } = setup({ version: 4, conversationMode: 'legacy' }, {
    settings: settingsDocument([selectedMode('经典平铺')]),
    fetch: () => new Promise((resolve) => { release = resolve; })
  });
  const reading = api.readNativeMode(api.topicContext());
  api.runtime.navigationRevision += 1;
  api.cancelNativeModeCheck();
  check(requests[0].init.signal.aborted, 'old settings read was not aborted');
  release({ ok: true, url: 'https://www.v2ex.com/settings', text: async () => 'old settings' });
  check(await reading === 'unknown' && api.runtime.nativeModeResult === null, 'stale read revived classic classification');
}

{
  const { api } = setup();
  const attrs = new Map([['aria-hidden', 'true']]);
  const removed = [];
  const native = {
    classList: { remove: (...names) => removed.push(...names) },
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name)
  };
  let disconnected = 0;
  let containerRemoved = false;
  const controller = new AbortController();
  const topic = {
    nativeReplies: [native],
    nativeAria: new Map([[native, 'false']]),
    threadedView: { remove() { containerRemoved = true; } },
    replyObserver: { disconnect() { disconnected += 1; } },
    thanksObserver: { disconnect() { disconnected += 1; } },
    pageRequests: new Set([controller])
  };
  api.runtime.topic = topic;
  api.disposeTopic();
  check(api.runtime.topic === null && controller.signal.aborted && disconnected === 2 && containerRemoved, 'legacy lifecycle not disposed');
  check(attrs.get('aria-hidden') === 'false' && removed.includes('wt-v2ex-native-hidden'), 'native visibility not restored');
}

{
  const { api } = setup();
  const image = (native) => ({
    dataset: {},
    closest: () => native ? {} : null,
    parentElement: { closest: () => null },
    hasAttribute: () => false
  });
  check(api.nativeImageInteraction(image(true)), 'linked image was not protected');
  check(!api.nativeImageInteraction(image(false)), 'plain image unnecessarily blocked');
}

// Exercise both actual image expansion paths with a scoped DOM double.
{
  const layoutTable = {};
  const markdownTable = {};
  const quote = {};
  const existingImage = {};
  const insertedLinks = [];
  const insertedText = [];
  const makeAnchor = (nearest, existing = false) => ({
    dataset: {},
    baseURI: 'https://www.v2ex.com/t/42',
    nextElementSibling: null,
    closest: () => nearest,
    matches: () => false,
    querySelector: () => existing ? existingImage : null,
    getAttribute: () => 'https://images.example/link.png',
    insertAdjacentElement: (_position, image) => insertedLinks.push(image.src)
  });
  const plainLink = makeAnchor(layoutTable);
  const protectedLink = makeAnchor(markdownTable);
  const renderedLink = makeAnchor(layoutTable, true);
  const makeText = (nearest, filename) => ({
    nodeValue: 'https://images.example/' + filename,
    baseURI: 'https://www.v2ex.com/t/42',
    parentElement: { closest: () => nearest },
    parentNode: { insertBefore: (image) => insertedText.push(image.src) },
    nextSibling: null
  });
  const plainText = makeText(layoutTable, 'plain.png');
  const protectedText = makeText(markdownTable, 'table.png');
  const quotedText = makeText(quote, 'quote.png');
  const content = {
    dataset: {},
    contains: (node) => node === markdownTable || node === quote,
    querySelectorAll: () => [plainLink, protectedLink, renderedLink]
  };
  const { api } = setup({}, {
    HTMLImageElement: class {},
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    document: {
      createElement: () => ({ dataset: {} }),
      createTreeWalker: (_root, _show, filter) => {
        const accepted = [plainText, protectedText, quotedText].filter((node) => filter.acceptNode(node) === 1);
        return { nextNode: () => accepted.shift() || null };
      }
    }
  });
  check(!api.hasContentAncestor(plainLink, content, 'table'), 'outer layout table suppressed images');
  check(api.hasContentAncestor(protectedLink, content, 'table'), 'inner Markdown table not excluded');
  api.enhanceLinkedImages(content);
  api.enhanceTextImages(content);
  check(insertedLinks.length === 1 && insertedLinks[0].endsWith('/link.png'), 'plain link expansion or protected link handling regressed');
  check(insertedText.length === 1 && insertedText[0].endsWith('/plain.png'), 'bare URL expansion or protected text handling regressed');
  api.enhanceLinkedImages(content);
  api.enhanceTextImages(content);
  check(insertedLinks.length === 1 && insertedText.length === 1, 'repeat scan duplicated previews');
}

// Starting from an already-loaded empty topic must reach initializeTopic
// through the real policy synchronization path, without waiting for a reply.
for (const policy of ['legacy', 'auto']) {
  let replies = [];
  let listPresent = true;
  let marker = null;
  let nextTimer = 0;
  const timers = new Map();
  const list = { querySelectorAll: (selector) => selector.includes('.cell[id^="r_"]') ? replies : [] };
  const document = {
    querySelector: (selector) => selector === '#topic-replies' && listPresent ? list
      : selector === '.ps_container .page_current' ? marker : null,
    querySelectorAll: (selector) => selector.includes('.cell[id^="r_"]') ? replies : []
  };
  const { api, requests } = setup({ version: 4, conversationMode: 'native', imagePreviewEnabled: false, imageLightboxEnabled: false }, {
    document,
    settings: settingsDocument([selectedMode('经典平铺')]),
    window: {
      setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id)
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; }
      observe(root) { this.root = root; }
      disconnect() { this.disconnected = true; }
    }
  });
  const context = api.topicContext();
  check(api.topicDomMatchesContext(context), 'existing empty first-page list rejected');
  check(!api.topicDomMatchesContext({ ...context, page: 2 }), 'markerless empty list accepted for later page');
  marker = { textContent: '2' };
  check(!api.topicDomMatchesContext(context), 'empty list with stale page marker accepted');
  check(api.topicDomMatchesContext({ ...context, page: 2 }), 'matching explicit page marker rejected');
  marker = null;
  listPresent = false;
  check(!api.topicDomMatchesContext(context), 'missing reply list accepted');
  listPresent = true;
  api.runtime.settings.conversationMode = policy;
  api.runtime.settings.legacyFallbackEnabled = policy === 'auto';
  api.refreshConversationPolicy();
  // Consume the actual scheduled slot, then await its synchronization.
  const scheduled = api.runtime.navigationSchedule;
  check(timers.get(scheduled)?.delay === 0, 'policy did not schedule synchronization');
  timers.delete(scheduled);
  api.runtime.navigationSchedule = 0;
  await api.synchronizeTopicPage();
  const observer = api.runtime.waitingReplyObserver;
  check(observer && observer.root === list && !observer.disconnected, 'empty topic never installed first-reply observer');
  check(requests.length === 1 && api.runtime.topic === null && timers.size === 0, 'empty topic fetched pages or left a DOM wait timer');
  observer.callback();
  check(api.runtime.waitingReplyObserver === observer && timers.size === 0, 'empty mutation prematurely ended observation');
  replies = [{}];
  observer.callback();
  check(observer.disconnected && api.runtime.waitingReplyObserver === null && timers.get(api.runtime.navigationSchedule)?.delay === 0, 'first reply did not trigger synchronization');
  api.runtime.settings.conversationMode = 'native';
  api.refreshConversationPolicy();
  const pending = api.runtime.navigationSchedule;
  observer.callback();
  check(api.runtime.navigationSchedule === pending && api.runtime.waitingReplyObserver === null, 'stale observer revived disabled policy');
}

console.log('native compatibility checks passed: ' + checks);
