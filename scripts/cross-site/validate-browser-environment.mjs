import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./browser-environment.user.js', import.meta.url), 'utf8');
const marker = '\n  initialize();\n})();';
const instrumented = source.replace(marker, `
  globalThis.testApi = { presetEnvironment, defaultSettings, validateEnvironment, validateSettings,
    resolveEnvironment, normalizeLanguage, loadSettings, patchGroup, installLanguage, installTimezone,
    installGeolocation, sharesPageRealm, applyEnvironment, initialize };
})();`);
assert.notEqual(instrumented, source, 'Test instrumentation must match the standalone source.');

function realm(setup = '') {
  const pending = new Map();
  let nextTimer = 1;
  const context = vm.createContext({
    URL, console, setTimeout(callback) { const id = nextTimer++; pending.set(id, callback); return id; },
    clearTimeout(id) { pending.delete(id); }
  });
  vm.runInContext(`
    class Navigator {
      get language() { if (!(this instanceof Navigator)) throw new TypeError(); return 'de-DE'; }
      get languages() { return Object.freeze(['de-DE', 'de']); }
    }
    class Geolocation {
      getCurrentPosition() { throw new Error('Native device location must not be requested.'); }
      watchPosition() { throw new Error('Native device location must not be watched.'); }
      clearWatch() { throw new Error('Native device watcher must not be used.'); }
    }
    globalThis.navigator = new Navigator();
    navigator.geolocation = new Geolocation();
    globalThis.document = { permissionsPolicy: { allowsFeature: () => true } };
    globalThis.isSecureContext = true;
    globalThis.location = new URL('https://example.test/first');
    globalThis.top = globalThis.self = globalThis.unsafeWindow = globalThis;
    globalThis.events = {};
    globalThis.addEventListener = (name, fn) => { events[name] = fn; };
    globalThis.stored = null;
    globalThis.GM_getValue = () => stored;
    globalThis.GM_setValue = () => {};
    globalThis.menus = [];
    globalThis.GM_registerMenuCommand = (...args) => menus.push(args);
    ${setup}
  `, context);
  vm.runInContext(instrumented, context);
  return {
    api: context.testApi, context,
    run: (code) => vm.runInContext(code, context),
    flush() { for (const [id, callback] of [...pending]) { if (pending.delete(id)) callback(); } }, pending
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('metadata is standalone, versioned, HTTP(S) only, top-level, and least privilege', () => {
  assert.ok(source.startsWith('// ==UserScript==\n'));
  assert.match(source, /@version\s+1\.0\.0\n/);
  assert.match(source, /const VERSION = '1\.0\.0'/);
  assert.deepEqual([...source.matchAll(/@match\s+(\S+)/g)].map((m) => m[1]), ['https://*/*', 'http://*/*']);
  assert.deepEqual([...source.matchAll(/@grant\s+(\S+)/g)].map((m) => m[1]), ['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'unsafeWindow']);
  assert.match(source, /@noframes/);
  assert.match(source, /@sandbox\s+raw/);
  assert.match(source, /@inject-into\s+page/);
  assert.doesNotMatch(source, /@(?:connect|require|resource)\b|\b(?:fetch|XMLHttpRequest|eval)\s*\(/);
});

test('all presets are independent, valid environments with illustrative coordinates', () => {
  const { api } = realm();
  for (const id of ['los-angeles', 'shanghai', 'tokyo']) {
    const environment = api.presetEnvironment(id);
    assert.deepEqual(plain(api.validateEnvironment(environment)), plain(environment));
    environment.profile.geolocation.latitude = 0;
    assert.notEqual(api.presetEnvironment(id).profile.geolocation.latitude, 0);
  }
  assert.throws(() => api.presetEnvironment('__proto__'), /Unknown preset/);
});

test('language normalization, strict field types, IANA zones, coordinate boundaries', () => {
  const { api } = realm();
  assert.equal(api.normalizeLanguage(' EN-us '), 'en-US');
  for (const bad of ['', null, 12, 'en_US']) assert.throws(() => api.normalizeLanguage(bad));
  const invalid = [
    (e) => { e.features.language = 1; }, (e) => { e.profile.languages = []; },
    (e) => { e.profile.languages = ['ja-JP']; }, (e) => { e.profile.languages = 'en-US'; },
    (e) => { e.profile.timezone = 'Mars/Olympus'; }, (e) => { e.profile.timezone = '+08:00'; },
    (e) => { e.profile.geolocation.latitude = 91; }, (e) => { e.profile.geolocation.latitude = '-90'; },
    (e) => { e.profile.geolocation.longitude = -181; }, (e) => { e.profile.geolocation.longitude = Infinity; },
    (e) => { e.profile.geolocation.accuracy = 0; }, (e) => { e.profile.geolocation.accuracy = NaN; },
    (e) => { e.profile.extra = true; }, (e) => { delete e.profile.language; }
  ];
  for (const mutate of invalid) {
    const environment = api.presetEnvironment(); mutate(environment);
    assert.throws(() => api.validateEnvironment(environment));
  }
  const environment = api.presetEnvironment();
  environment.profile.geolocation = { latitude: -90, longitude: 180, accuracy: 0.1 };
  assert.doesNotThrow(() => api.validateEnvironment(environment));
  environment.profile.timezone = 'PST8PDT';
  assert.doesNotThrow(() => api.validateEnvironment(environment), 'Legacy IANA identifiers may contain digits without a slash.');
});

test('master, exact-origin disabled/site/global/native precedence; no substring matches', () => {
  const { api } = realm();
  const settings = api.defaultSettings();
  assert.equal(api.resolveEnvironment(settings, 'https://example.test').environment, null);
  settings.enabled = true;
  assert.equal(api.resolveEnvironment(settings, 'https://example.test').environment, null);
  settings.global.enabled = true;
  assert.equal(api.resolveEnvironment(settings, 'https://example.test').scope, 'Global default');
  settings.sites['https://example.test'] = { mode: 'profile', environment: api.presetEnvironment('tokyo') };
  assert.equal(api.resolveEnvironment(settings, 'https://example.test').environment.profile.language, 'ja-JP');
  for (const origin of ['http://example.test', 'https://sub.example.test', 'https://example.test.evil.test', 'https://example.test:8443']) {
    assert.equal(api.resolveEnvironment(settings, origin).scope, 'Global default');
  }
  settings.sites['https://example.test'] = { mode: 'disabled' };
  assert.equal(api.resolveEnvironment(settings, 'https://example.test').environment, null);
  settings.enabled = false;
  assert.equal(api.resolveEnvironment(settings, 'https://unconfigured.test').environment, null);
  assert.equal(api.resolveEnvironment(settings, 'chrome://settings').environment, null);
});

test('corrupted, outdated, async-only, or inaccessible storage safely disables everything', () => {
  for (const stored of [false, {}, { version: 0 }, 'bad', []]) {
    const { api, context } = realm(); context.stored = stored;
    assert.equal(api.loadSettings().settings.enabled, false);
    assert.ok(api.loadSettings().error);
  }
  const r = realm('GM_getValue = () => { throw new Error("Storage unavailable"); };');
  assert.match(r.api.loadSettings().error, /Storage unavailable/);
  const asyncOnly = realm('GM_getValue = async () => null;');
  assert.equal(asyncOnly.api.loadSettings().settings.enabled, false);
  assert.ok(asyncOnly.api.loadSettings().error);
  const { api } = realm();
  for (const origin of ['example.test', 'https://example.test/', 'https://example.test/path', 'file:///tmp/a']) {
    const settings = api.defaultSettings(); settings.sites[origin] = { mode: 'disabled' };
    assert.throws(() => api.validateSettings(settings), /exact HTTP/);
  }
});

test('native fresh install, repeated initialization, routes, and frames', () => {
  const r = realm();
  r.run('globalThis.before = [Date, Intl.DateTimeFormat, Intl.NumberFormat, Date.prototype.getHours, navigator.geolocation.watchPosition];');
  r.api.initialize(); r.api.initialize();
  assert.equal(r.context.menus.length, 1);
  assert.equal(r.run('before.every((fn, i) => fn === [Date, Intl.DateTimeFormat, Intl.NumberFormat, Date.prototype.getHours, navigator.geolocation.watchPosition][i])'), true);
  r.run('location = new URL("https://example.test/next?x=1");');
  r.api.initialize();
  assert.equal(r.context.menus.length, 1);
  const frame = realm('top = {};'); frame.api.initialize(); assert.equal(frame.context.menus.length, 0);
  const internal = realm('location = new URL("about:blank");'); internal.api.initialize(); assert.equal(internal.context.menus.length, 0);
});

test('language/locale changes preserve explicit locales, prototypes, constructors, and errors', () => {
  const r = realm();
  r.run('globalThis.OriginalDate = Date;');
  r.api.installLanguage(r.api.presetEnvironment('tokyo').profile);
  assert.equal(r.run('navigator.language'), 'ja-JP');
  assert.deepEqual(plain(r.run('navigator.languages')), ['ja-JP', 'ja']);
  assert.equal(r.run('Object.isFrozen(navigator.languages)'), true);
  assert.equal(r.run('Intl.DateTimeFormat().resolvedOptions().locale'), 'ja-JP');
  assert.equal(r.run('new Intl.NumberFormat([]).resolvedOptions().locale'), 'ja-JP');
  assert.equal(r.run('Intl.NumberFormat("fr-FR").resolvedOptions().locale'), 'fr-FR');
  assert.equal(r.run('Intl.DateTimeFormat("en-GB").resolvedOptions().locale'), 'en-GB');
  assert.equal(r.run('(1234.5).toLocaleString()'), '1,234.5');
  assert.equal(r.run('Date === OriginalDate && new Date() instanceof Date'), true);
  assert.equal(r.run('new Intl.DateTimeFormat() instanceof Intl.DateTimeFormat'), true);
  assert.equal(r.run('new Intl.NumberFormat().constructor === Intl.NumberFormat'), true);
  assert.equal(r.run('(new (class extends Intl.DateTimeFormat {})()).resolvedOptions().locale'), 'ja-JP');
  assert.equal(r.run('typeof Intl.NumberFormat.supportedLocalesOf("ja-JP")[0]'), 'string');
  assert.throws(() => r.run('Intl.DateTimeFormat(null)'), /TypeError/);
  assert.throws(() => r.run('Number.prototype.toLocaleString.call({})'), /TypeError/);
});

test('Los Angeles DST changes at the represented instant, including repeated/missing hours', () => {
  const r = realm(); r.api.installTimezone(r.api.presetEnvironment().profile);
  for (const [iso, offset, hours, minutes] of [
    ['2026-01-15T12:00:00Z', 480, 4, 0], ['2026-07-15T12:00:00Z', 420, 5, 0],
    ['2026-03-08T09:59:59Z', 480, 1, 59], ['2026-03-08T10:00:00Z', 420, 3, 0],
    ['2026-11-01T08:59:59Z', 420, 1, 59], ['2026-11-01T09:00:00Z', 480, 1, 0]
  ]) {
    r.context.iso = iso;
    assert.deepEqual(plain(r.run('(() => { const d = new Date(iso); return [d.getTimezoneOffset(), d.getHours(), d.getMinutes()]; })()')), [offset, hours, minutes], iso);
  }
  assert.equal(r.run('Intl.DateTimeFormat().resolvedOptions().timeZone'), 'America/Los_Angeles');
  assert.equal(r.run('new Date("2026-01-15T04:05:06.789Z").toString().startsWith("Wed Jan 14 2026 20:05:06 GMT-0800")'), true);
  assert.deepEqual(plain(r.run('(() => { const d = new Date("2026-01-15T04:05:06.789Z"); return [d.getFullYear(), d.getMonth(), d.getDate(), d.getDay(), d.getSeconds(), d.getMilliseconds()]; })()')), [2026, 0, 14, 3, 6, 789]);
});

test('Shanghai and Tokyo use correct offsets in both seasons; negative timestamps and year zero', () => {
  for (const [id, offset] of [['shanghai', -480], ['tokyo', -540]]) {
    const r = realm(); r.api.installTimezone(r.api.presetEnvironment(id).profile);
    assert.equal(r.run('new Date("2026-01-15T12:00Z").getTimezoneOffset()'), offset);
    assert.equal(r.run('new Date("2026-07-15T12:00Z").getTimezoneOffset()'), offset);
  }
  const r = realm(); r.api.installTimezone(r.api.presetEnvironment().profile);
  assert.equal(r.run('new Date(-1).getTimezoneOffset()'), 480);
  assert.equal(r.run('new Date("0000-01-01T00:00:00Z").getFullYear()'), -1);
  assert.equal(r.run('new Date(NaN).toString()'), 'Invalid Date');
  assert.equal(Number.isNaN(r.run('new Date(NaN).getTimezoneOffset()')), true);
  assert.throws(() => r.run('Date.prototype.getHours.call({})'), /TypeError/);
});

test('Date timestamp/UTC/constructor invariants and explicit Intl options survive both features', () => {
  const r = realm();
  r.run(`globalThis.timestamp = Date.parse('2026-07-15T12:34:56.789Z');
    globalThis.original = { Date, getTime: Date.prototype.getTime, toISOString: Date.prototype.toISOString,
      utc: new Date(timestamp).getUTCHours(), localConstructor: new Date(2026, 6, 15, 12).getTime(),
      explicit: new Date(timestamp).toLocaleString('fr-FR', {timeZone:'Europe/Paris'}) };
    globalThis.start = Date.now();`);
  r.api.installLanguage(r.api.presetEnvironment('shanghai').profile);
  r.api.installTimezone(r.api.presetEnvironment().profile);
  assert.equal(r.run('Date === original.Date && Date.prototype.getTime === original.getTime && Date.prototype.toISOString === original.toISOString'), true);
  assert.equal(r.run('new Date(timestamp).getTime() === timestamp && new Date(timestamp).valueOf() === timestamp'), true);
  assert.equal(r.run('new Date(timestamp).toISOString()'), '2026-07-15T12:34:56.789Z');
  assert.equal(r.run('new Date(timestamp).getUTCHours() === original.utc && new Date(2026, 6, 15, 12).getTime() === original.localConstructor'), true);
  assert.equal(r.run('Date.now() >= start && Date.now() - start < 5000'), true);
  assert.equal(r.run('new Date(timestamp).toLocaleString("fr-FR", {timeZone:"Europe/Paris"}) === original.explicit'), true);
  assert.equal(r.run('Intl.DateTimeFormat("en-GB", {timeZone:"UTC"}).resolvedOptions().timeZone'), 'UTC');
  assert.equal(r.run('Intl.DateTimeFormat().resolvedOptions().locale'), 'zh-CN');
  assert.equal(r.run('new Intl.DateTimeFormat().constructor === Intl.DateTimeFormat'), true);
  assert.equal(r.run('(() => { let reads = 0; const options = Object.create({get timeZone() { reads++; return "UTC"; }}); const f = Intl.DateTimeFormat(undefined, options); return reads === 1 && f.resolvedOptions().timeZone === "UTC"; })()'), true);
  assert.throws(() => r.run('Intl.DateTimeFormat(undefined, null)'), /TypeError/);
});

test('each feature is independent and a non-configurable descriptor leaves its group native', () => {
  const r = realm();
  const environment = r.api.presetEnvironment(); environment.features.language = false;
  const results = r.api.applyEnvironment(environment, true);
  assert.equal(r.run('navigator.language'), 'de-DE');
  assert.equal(r.run('Intl.DateTimeFormat().resolvedOptions().timeZone'), 'America/Los_Angeles');
  assert.match(results.language, /Native/);
  const frozen = realm('Object.defineProperty(Intl, "NumberFormat", {configurable:false}); globalThis.before = [Intl.DateTimeFormat, Date.prototype.toLocaleString];');
  const failed = frozen.api.applyEnvironment(frozen.api.presetEnvironment(), true);
  assert.match(failed.language, /Not applied/);
  assert.equal(frozen.run('navigator.language'), 'de-DE');
  assert.match(failed.timezone, /Installed/);
  const dateFrozen = realm('Object.defineProperty(Date.prototype, "getHours", {configurable:false}); globalThis.before = [Intl.DateTimeFormat, Date.prototype.getTimezoneOffset];');
  const f = dateFrozen.api.applyEnvironment({ ...dateFrozen.api.presetEnvironment(), features: { language:false, timezone:true, geolocation:false } }, true);
  assert.match(f.timezone, /Not applied/);
  assert.equal(dateFrozen.run('before[0] === Intl.DateTimeFormat && before[1] === Date.prototype.getTimezoneOffset'), true);
});

test('patch rollback restores prior descriptors if definition fails midway', () => {
  const r = realm();
  r.run('globalThis.target = { first:1 }; globalThis.reject = new Proxy({second:2}, {defineProperty() {throw new Error("Denied");}});');
  assert.throws(() => r.api.patchGroup([
    { target:r.context.target, key:'first', descriptor:{value:3, configurable:true} },
    { target:r.context.reject, key:'second', descriptor:{value:4, configurable:true} }
  ]), /Denied/);
  assert.equal(r.context.target.first, 1);
});

test('unsupported page worlds report failure and never patch sandbox-only observations', () => {
  const r = realm('unsafeWindow = { Object: class ForeignObject {} };');
  assert.equal(r.api.sharesPageRealm(), false);
  const results = r.api.applyEnvironment(r.api.presetEnvironment(), false);
  assert.equal(r.run('navigator.language'), 'de-DE');
  for (const value of Object.values(results)) assert.match(value, /page execution world unavailable/);
});

test('geolocation callbacks are asynchronous, static, valid, concurrent, and cancellable', () => {
  const r = realm(); r.api.installGeolocation(r.api.presetEnvironment().profile);
  r.run(`globalThis.positions = []; globalThis.cancelled = 0;
    navigator.geolocation.getCurrentPosition((p) => positions.push(p));
    globalThis.one = navigator.geolocation.watchPosition((p) => positions.push(p));
    globalThis.two = navigator.geolocation.watchPosition(() => cancelled++);
    navigator.geolocation.clearWatch(String(two));`);
  assert.equal(r.context.positions.length, 0);
  assert.ok(r.context.one > 0 && r.context.two > r.context.one);
  r.flush();
  assert.equal(r.context.positions.length, 2);
  assert.equal(r.context.cancelled, 0);
  assert.equal(r.pending.size, 0);
  const position = r.context.positions[0];
  assert.equal(position.coords.latitude, 34.0522);
  assert.equal(position.coords.accuracy, 100);
  for (const key of ['altitude', 'altitudeAccuracy', 'heading', 'speed']) assert.equal(position.coords[key], null);
  assert.ok(Math.abs(position.timestamp - Date.now()) < 2000);
  assert.deepEqual(plain(position.toJSON()), { coords: plain(position.coords), timestamp:position.timestamp });
  r.run('navigator.geolocation.clearWatch(one); navigator.geolocation.clearWatch(98765);');
  r.flush(); assert.equal(r.context.positions.length, 2);
  r.run('navigator.geolocation.watchPosition(() => cancelled++); events.pagehide();');
  r.flush(); assert.equal(r.context.cancelled, 0); assert.equal(r.pending.size, 0);
});

test('bad geolocation callbacks, unavailable APIs, insecure contexts and policy fail safely', () => {
  const r = realm(); r.api.installGeolocation(r.api.presetEnvironment().profile);
  for (const code of [
    'navigator.geolocation.getCurrentPosition()', 'navigator.geolocation.watchPosition(null)',
    'navigator.geolocation.watchPosition(() => {}, 5)', 'navigator.geolocation.getCurrentPosition(() => {}, null, 5)',
    'navigator.geolocation.getCurrentPosition.call({}, () => {})', 'navigator.geolocation.clearWatch()'
  ]) assert.throws(() => r.run(code), /TypeError/);
  for (const setup of ['isSecureContext = false;', 'delete navigator.geolocation;', 'document.permissionsPolicy.allowsFeature = () => false;']) {
    const unavailable = realm(setup);
    const results = unavailable.api.applyEnvironment(unavailable.api.presetEnvironment(), true);
    assert.match(results.geolocation, /Not applied/);
    assert.match(results.language, /Installed/);
  }
});

test('clearWatch cannot cancel a one-time position request; static callbacks retain no timers', () => {
  const r = realm(); r.api.installGeolocation(r.api.presetEnvironment().profile);
  r.run(`globalThis.calls = 0;
    navigator.geolocation.getCurrentPosition(() => calls++);
    const id = navigator.geolocation.watchPosition(() => calls++);
    navigator.geolocation.clearWatch(id);`);
  r.flush();
  assert.equal(r.context.calls, 1);
  assert.equal(r.pending.size, 0);
});

test('Date range endpoints retain finite offsets and valid local strings', () => {
  for (const id of ['los-angeles', 'shanghai', 'tokyo']) {
    const r = realm(); r.api.installTimezone(r.api.presetEnvironment(id).profile);
    for (const timestamp of [-8640000000000000, 8640000000000000]) {
      r.context.timestamp = timestamp;
      assert.equal(r.run('Number.isFinite(new Date(timestamp).getTimezoneOffset())'), true);
      assert.equal(r.run('new Date(timestamp).getTime()'), timestamp);
      assert.doesNotMatch(r.run('new Date(timestamp).toString()'), /NaN|undefined|Invalid/);
    }
  }
});

test('missing Intl leaves initialization and the settings menu available', () => {
  const r = realm('globalThis.Intl = undefined;');
  assert.doesNotThrow(() => r.api.initialize());
  assert.equal(r.context.menus.length, 1);
  assert.throws(() => r.api.validateEnvironment(r.api.presetEnvironment()));
});
