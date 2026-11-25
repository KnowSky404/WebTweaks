import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./conversation-enhancer.user.js', import.meta.url), 'utf8');
const marker = '\n  initialize();\n})();';
const instrumented = source.replace(marker, '\n  globalThis.__nativeCompatibilityTest = { runtime, classifyNativeMode, nativeModeFromSettings, wantsLegacyConversation, initializeTopic, readNativeMode, cancelNativeModeCheck, topicContext, isFlatReplyList, disposeTopic, nativeImageInteraction };\n})();');
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
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    document: { querySelectorAll() { throw new Error('native policy must not scan the reply DOM'); } },
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

console.log('native compatibility checks passed: ' + checks);
