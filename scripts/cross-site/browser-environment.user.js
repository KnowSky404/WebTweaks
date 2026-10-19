// ==UserScript==
// @name         Browser Environment Spoofer
// @name:zh-CN   浏览器环境配置
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.0.0
// @description  Opt-in, per-origin JavaScript language, locale, timezone, and simulated geolocation for testing.
// @description:zh-CN 默认关闭，按站点配置 JavaScript 语言、区域、时区及模拟定位。
// @author       KnowSky404
// @match        https://*/*
// @match        http://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// @sandbox      raw
// @inject-into  page
// @noframes
// @homepageURL  https://github.com/KnowSky404/WebTweaks/tree/main/scripts/cross-site
// @supportURL   https://github.com/KnowSky404/WebTweaks/issues
// @updateURL    https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/cross-site/browser-environment.user.js
// @downloadURL  https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/cross-site/browser-environment.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '1.0.0';
  const SETTINGS_KEY = 'wt-browser-environment:settings';
  const HOST_ID = 'wt-browser-environment-host';
  const NativeDate = Date;
  const NativeDateTimeFormat = globalThis.Intl?.DateTimeFormat;
  const nativeGetTime = Date.prototype.getTime;
  const nativeCanonicalLocales = globalThis.Intl?.getCanonicalLocales;
  const canonicalLocales = (locales) => {
    if (typeof nativeCanonicalLocales !== 'function') throw new Error('Intl language validation is unavailable.');
    return Reflect.apply(nativeCanonicalLocales, globalThis.Intl, [locales]);
  };
  const PRESETS = Object.freeze({
    'los-angeles': {
      label: 'United States — Los Angeles', language: 'en-US', languages: ['en-US', 'en'],
      timezone: 'America/Los_Angeles', geolocation: { latitude: 34.0522, longitude: -118.2437, accuracy: 100 }
    },
    shanghai: {
      label: 'China — Shanghai', language: 'zh-CN', languages: ['zh-CN', 'zh'],
      timezone: 'Asia/Shanghai', geolocation: { latitude: 31.2304, longitude: 121.4737, accuracy: 100 }
    },
    tokyo: {
      label: 'Japan — Tokyo', language: 'ja-JP', languages: ['ja-JP', 'ja'],
      timezone: 'Asia/Tokyo', geolocation: { latitude: 35.6762, longitude: 139.6503, accuracy: 100 }
    }
  });

  function presetEnvironment(id = 'los-angeles') {
    if (!Object.hasOwn(PRESETS, id)) throw new Error('Unknown preset.');
    const { label, ...profile } = PRESETS[id];
    return { features: { language: true, timezone: true, geolocation: true }, profile: JSON.parse(JSON.stringify(profile)) };
  }

  function defaultSettings() {
    return { version: 1, enabled: false, global: { enabled: false, environment: presetEnvironment() }, sites: {} };
  }

  function objectWithKeys(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
      throw new Error(`${label} has an invalid structure.`);
    }
  }

  function boolean(value, label) {
    if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
    return value;
  }

  function normalizeLanguage(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Use a nonempty BCP 47 language tag.');
    try { return canonicalLocales(value.trim())[0]; }
    catch { throw new Error(`Invalid language tag: ${value}`); }
  }

  function validateEnvironment(value) {
    objectWithKeys(value, ['features', 'profile'], 'Environment');
    objectWithKeys(value.features, ['language', 'timezone', 'geolocation'], 'Feature switches');
    objectWithKeys(value.profile, ['language', 'languages', 'timezone', 'geolocation'], 'Profile');
    const features = Object.fromEntries(Object.entries(value.features).map(([key, enabled]) => [key, boolean(enabled, key)]));
    const profile = value.profile;
    const language = normalizeLanguage(profile.language);
    if (!Array.isArray(profile.languages) || !profile.languages.length) throw new Error('Preferred languages must be a nonempty list.');
    const languages = [...new Set(profile.languages.map(normalizeLanguage))];
    if (languages[0] !== language) throw new Error('The first preferred language must match the primary language.');
    let timezone;
    try {
      // Offset strings accepted by newer Intl versions are not IANA identifiers.
      if (typeof profile.timezone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\/-]*$/.test(profile.timezone)) throw new Error();
      timezone = new NativeDateTimeFormat('en-US', { timeZone: profile.timezone }).resolvedOptions().timeZone;
    } catch { throw new Error('Use a valid IANA timezone, for example America/Los_Angeles.'); }
    objectWithKeys(profile.geolocation, ['latitude', 'longitude', 'accuracy'], 'Coordinates');
    const { latitude, longitude, accuracy } = profile.geolocation;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('Latitude must be a number from -90 to 90.');
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Longitude must be a number from -180 to 180.');
    if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy <= 0) throw new Error('Accuracy must be a finite positive number of meters.');
    return { features, profile: { language, languages, timezone, geolocation: { latitude, longitude, accuracy } } };
  }

  function isOrigin(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && url.origin === value;
    } catch { return false; }
  }

  function validateSettings(value) {
    objectWithKeys(value, ['version', 'enabled', 'global', 'sites'], 'Settings');
    if (value.version !== 1) throw new Error('Unsupported settings version. Reset to defaults to recover.');
    objectWithKeys(value.global, ['enabled', 'environment'], 'Global rule');
    if (!value.sites || typeof value.sites !== 'object' || Array.isArray(value.sites)) throw new Error('Invalid site rules.');
    const sites = {};
    for (const [origin, rule] of Object.entries(value.sites)) {
      if (!isOrigin(origin)) throw new Error('Site rules must use exact HTTP(S) origins.');
      if (rule?.mode === 'disabled') {
        objectWithKeys(rule, ['mode'], 'Disabled site rule');
        sites[origin] = { mode: 'disabled' };
      } else {
        objectWithKeys(rule, ['mode', 'environment'], 'Site rule');
        if (rule.mode !== 'profile') throw new Error('Invalid site rule mode.');
        sites[origin] = { mode: 'profile', environment: validateEnvironment(rule.environment) };
      }
    }
    return {
      version: 1, enabled: boolean(value.enabled, 'Master switch'),
      global: { enabled: boolean(value.global.enabled, 'Global switch'), environment: validateEnvironment(value.global.environment) }, sites
    };
  }

  function resolveEnvironment(settings, origin) {
    if (!isOrigin(origin) || !settings.enabled) return { scope: 'Native — master switch off', environment: null };
    const site = settings.sites[origin];
    if (site?.mode === 'disabled') return { scope: 'Native — explicitly disabled site', environment: null };
    if (site?.mode === 'profile') return { scope: 'Current origin', environment: site.environment };
    if (settings.global.enabled) return { scope: 'Global default', environment: settings.global.environment };
    return { scope: 'Native — no applicable rule', environment: null };
  }

  function loadSettings() {
    try {
      if (typeof GM_getValue !== 'function') throw new Error('Synchronous GM storage is unavailable.');
      const stored = GM_getValue(SETTINGS_KEY, null);
      return { settings: stored === null ? defaultSettings() : validateSettings(stored), error: '' };
    } catch (error) {
      return { settings: defaultSettings(), error: `Settings were not applied: ${error.message}` };
    }
  }

  function propertyOwner(target, key) {
    for (let owner = target; owner; owner = Object.getPrototypeOf(owner)) {
      if (Object.hasOwn(owner, key)) return owner;
    }
    throw new Error(`${key} is unavailable.`);
  }

  function valuePatch(target, key, value) {
    return { target, key, descriptor: { ...Object.getOwnPropertyDescriptor(target, key), value } };
  }

  function patchGroup(patches) {
    // Preflight every descriptor before touching any API in this feature group.
    const originals = patches.map(({ target, key }) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor?.configurable) throw new Error(`${String(key)} cannot be safely overridden.`);
      return { target, key, descriptor };
    });
    let applied = 0;
    try {
      for (const { target, key, descriptor } of patches) {
        Object.defineProperty(target, key, descriptor);
        applied++;
      }
    } catch (error) {
      for (const { target, key, descriptor } of originals.slice(0, applied).reverse()) Object.defineProperty(target, key, descriptor);
      throw error;
    }
  }

  function defaultLocale(locales, language) {
    return locales === undefined || (Array.isArray(locales) && locales.length === 0) ? language : locales;
  }

  function timezoneOptions(options, timezone) {
    if (options === null) return options; // Preserve the native TypeError.
    if (options === undefined) return { timeZone: timezone };
    // Preserve inherited/non-enumerable options and read accessors only when Intl does.
    return new Proxy(Object(options), {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return key === 'timeZone' && value === undefined ? timezone : value;
      }
    });
  }

  function formatterPatches(name, transform) {
    const target = Intl[name];
    if (typeof target !== 'function') throw new Error(`Intl.${name} is unavailable.`);
    const wrapper = new Proxy(target, {
      apply(fn, receiver, args) { return Reflect.apply(fn, receiver, transform(args)); },
      construct(fn, args, newTarget) { return Reflect.construct(fn, transform(args), newTarget); }
    });
    return [valuePatch(Intl, name, wrapper), valuePatch(target.prototype, 'constructor', wrapper)];
  }

  function localeMethodPatches(transform, includeNumber = false) {
    const patches = ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].map((key) => {
      const original = Date.prototype[key];
      return valuePatch(Date.prototype, key, function (locales, options) {
        return Reflect.apply(original, this, transform([locales, options]));
      });
    });
    if (includeNumber) {
      const original = Number.prototype.toLocaleString;
      patches.push(valuePatch(Number.prototype, 'toLocaleString', function (locales, options) {
        return Reflect.apply(original, this, transform([locales, options]));
      }));
    }
    return patches;
  }

  function installLanguage(profile) {
    const languages = Object.freeze([...profile.languages]);
    const patches = [];
    for (const [key, value] of [['language', profile.language], ['languages', languages],
      ...['userLanguage', 'browserLanguage', 'systemLanguage'].filter((key) => key in navigator).map((key) => [key, profile.language])]) {
      const owner = propertyOwner(navigator, key);
      const original = Object.getOwnPropertyDescriptor(owner, key);
      patches.push({ target: owner, key, descriptor: {
        configurable: original.configurable, enumerable: original.enumerable,
        get() {
          if (original.get) Reflect.apply(original.get, this, []); // Keep native receiver checks.
          return value;
        }
      } });
    }
    const transform = ([locales, options]) => [defaultLocale(locales, profile.language), options];
    patches.push(...formatterPatches('DateTimeFormat', transform), ...formatterPatches('NumberFormat', transform), ...localeMethodPatches(transform, true));
    patchGroup(patches);
  }

  function timezoneReader(timezone) {
    const formatter = new NativeDateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone, era: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    const zoneFormatter = new NativeDateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'long' });
    let previousTime;
    let previousParts;
    return (date) => {
      const time = Reflect.apply(nativeGetTime, date, []);
      if (Number.isNaN(time)) return null;
      if (time === previousTime) return previousParts;
      const parts = Object.fromEntries(formatter.formatToParts(time).map(({ type, value }) => [type, value]));
      const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
      const utc = new NativeDate(time);
      // IANA offsets shift the calendar date by at most one day. Compare calendar
      // components rather than constructing a shifted Date outside TimeClip's range.
      const dayDifference = Math.sign(year - utc.getUTCFullYear()
        || Number(parts.month) - 1 - utc.getUTCMonth() || Number(parts.day) - utc.getUTCDate());
      const localSeconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
      const utcSeconds = utc.getUTCHours() * 3600 + utc.getUTCMinutes() * 60 + utc.getUTCSeconds();
      const offset = (utcSeconds - localSeconds - dayDifference * 86400) / 60;
      previousTime = time;
      previousParts = {
        year, month: Number(parts.month) - 1, date: Number(parts.day),
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), offset,
        zone: zoneFormatter.formatToParts(time).find(({ type }) => type === 'timeZoneName')?.value || timezone
      };
      return previousParts;
    };
  }

  function installTimezone(profile) {
    const read = timezoneReader(profile.timezone);
    const transform = ([locales, options]) => [locales, timezoneOptions(options, profile.timezone)];
    const patches = [...formatterPatches('DateTimeFormat', transform), ...localeMethodPatches(transform)];
    const getters = {
      getFullYear: 'year', getMonth: 'month', getDate: 'date', getDay: 'day',
      getHours: 'hour', getMinutes: 'minute', getSeconds: 'second', getTimezoneOffset: 'offset'
    };
    for (const [method, part] of Object.entries(getters)) {
      patches.push(valuePatch(Date.prototype, method, function () { return read(this)?.[part] ?? NaN; }));
    }
    if (typeof Date.prototype.getYear === 'function') {
      patches.push(valuePatch(Date.prototype, 'getYear', function () { return (read(this)?.year ?? NaN) - 1900; }));
    }
    const pad = (number) => String(number).padStart(2, '0');
    function dateString(parts) {
      const year = parts.year < 0 ? `-${String(-parts.year).padStart(4, '0')}` : String(parts.year).padStart(4, '0');
      return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parts.day]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parts.month]} ${pad(parts.date)} ${year}`;
    }
    function timeString(parts) {
      const minutes = Math.abs(parts.offset);
      return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} GMT${parts.offset <= 0 ? '+' : '-'}${pad(Math.floor(minutes / 60))}${pad(Math.floor(minutes % 60))} (${parts.zone})`;
    }
    for (const [method, format] of [
      ['toString', (p) => `${dateString(p)} ${timeString(p)}`], ['toDateString', dateString], ['toTimeString', timeString]
    ]) {
      patches.push(valuePatch(Date.prototype, method, function () {
        const parts = read(this);
        return parts ? format(parts) : 'Invalid Date';
      }));
    }
    patchGroup(patches);
  }

  function installGeolocation(profile) {
    if (!globalThis.isSecureContext || !navigator.geolocation) throw new Error('Geolocation is unavailable outside supported secure contexts.');
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature('geolocation')) throw new Error('Geolocation is blocked by Permissions Policy.');
    const geolocation = navigator.geolocation;
    const watchers = new Map();
    const timers = new Set();
    let nextId = 1;
    function checkArguments(receiver, success, error, options) {
      if (receiver !== geolocation) throw new TypeError('Illegal geolocation receiver.');
      if (typeof success !== 'function') throw new TypeError('A geolocation success callback is required.');
      if (error != null && typeof error !== 'function') throw new TypeError('The error callback must be a function or null.');
      if (options != null && !['object', 'function'].includes(typeof options)) throw new TypeError('Geolocation options must be an object.');
    }
    function position() {
      const data = { ...profile.geolocation, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
      const coords = Object.freeze({ ...data, toJSON: () => ({ ...data }) });
      const timestamp = NativeDate.now();
      return Object.freeze({ coords, timestamp, toJSON: () => ({ coords: { ...data }, timestamp }) });
    }
    function schedule(success, watch = false) {
      if (watch && nextId > 2147483647) throw new RangeError('Simulated geolocation watch identifiers exhausted.');
      const id = watch ? nextId++ : undefined;
      const timer = setTimeout(() => {
        if (!timers.delete(timer)) return;
        if (watch) watchers.delete(id);
        Reflect.apply(success, undefined, [position()]);
      }, 0);
      timers.add(timer);
      if (watch) watchers.set(id, timer);
      return id;
    }
    const methods = {
      getCurrentPosition(success, error, options) {
        checkArguments(this, success, error, options);
        schedule(success);
      },
      watchPosition(success, error, options) {
        checkArguments(this, success, error, options);
        return schedule(success, true);
      },
      clearWatch(id) {
        if (this !== geolocation) throw new TypeError('Illegal geolocation receiver.');
        if (!arguments.length) throw new TypeError('A watch identifier is required.');
        const key = Number(id) >> 0;
        const timer = watchers.get(key);
        if (timer !== undefined) { clearTimeout(timer); timers.delete(timer); }
        watchers.delete(key);
      }
    };
    patchGroup(Object.entries(methods).map(([key, method]) => valuePatch(propertyOwner(geolocation, key), key, method)));
    globalThis.addEventListener('pagehide', () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      watchers.clear();
    });
  }

  function sharesPageRealm() {
    try {
      return typeof unsafeWindow !== 'undefined' && unsafeWindow.Object === Object
        && unsafeWindow.Function.prototype === Function.prototype && unsafeWindow.navigator === navigator;
    } catch { return false; }
  }

  function applyEnvironment(environment, pageRealm) {
    const results = {};
    for (const [feature, installer] of [['language', installLanguage], ['timezone', installTimezone], ['geolocation', installGeolocation]]) {
      if (!environment?.features[feature]) { results[feature] = 'Native — not enabled'; continue; }
      if (!pageRealm) { results[feature] = 'Not applied — page execution world unavailable'; continue; }
      try { installer(environment.profile); results[feature] = 'Installed — see observed values below'; }
      catch (error) { results[feature] = `Not applied — ${error.message}`; }
    }
    return results;
  }

  function initialize() {
    if (!['https:', 'http:'].includes(location.protocol) || globalThis.top !== globalThis.self) return;
    const marker = Symbol.for('wt.browser-environment.initialized');
    if (globalThis[marker]) return;
    Object.defineProperty(globalThis, marker, { value: true });
    const loaded = loadSettings();
    const effective = resolveEnvironment(loaded.settings, location.origin);
    const pageRealm = sharesPageRealm();
    const results = applyEnvironment(effective.environment, pageRealm);
    const runtime = {
      loaded, effective, pageRealm, results, panel: null, reloadNeeded: false,
      simulatedGetter: results.geolocation.startsWith('Installed') ? navigator.geolocation.getCurrentPosition : null
    };
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Browser Environment Spoofer — Settings', () => openSettings(runtime));
    } else {
      console.warn('[WebTweaks:Browser Environment] Settings menu is unavailable in this userscript manager.');
    }
  }

  function settingsContent() {
    // Build DOM directly, including on sites enforcing Trusted Types. No HTML sinks.
    const element = (tag, attributes = {}, ...children) => {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      node.append(...children);
      return node;
    };
    const control = (tag, name, attributes = {}, ...children) => element(tag, { [`data-${name}`]: '', ...attributes }, ...children);
    const button = (name, text, attributes = {}) => control('button', name, { type: 'button', ...attributes }, text);
    const option = (value, text) => element('option', { value }, text);
    const field = (text, input, attributes = {}) => element('label', attributes, text, input);
    const note = (text, attributes = {}) => element('p', { class: 'wt-muted', ...attributes }, text);
    const checkbox = (name, text, attributes = {}) => element('label', attributes, control('input', name, { type: 'checkbox' }), text);
    return [
      element('div', { class: 'wt-header' },
        element('div', {}, element('h2', { id: 'wt-title' }, 'Browser Environment Spoofer'),
          element('p', { class: 'wt-muted' }, 'JavaScript environment testing · ', control('span', 'version'))),
        button('close', '×', { 'aria-label': 'Close settings' })),
      control('p', 'status', { class: 'wt-status' }),
      checkbox('master', 'Enable environment overrides (master)'),
      element('div', { class: 'wt-grid' },
        field('Edit scope', control('select', 'scope', {}, option('site', 'Current origin'), option('global', 'Global default')), { class: 'wt-wide' }),
        field('Current origin rule', control('select', 'rule', {},
          option('inherit', 'Inherit global default / native'), option('profile', 'Use this profile'), option('disabled', 'Always use native environment')),
        { class: 'wt-wide', 'data-site-row': '' }),
        checkbox('global-enabled', 'Apply global default on all eligible sites', { class: 'wt-wide', 'data-global-row': '', hidden: '' }),
        note('Global overrides can break applications. Explicit site rules take priority. Both HTTP and HTTPS pages match; geolocation requires a secure context.',
          { class: 'wt-wide wt-muted', 'data-warning': '', hidden: '' }),
        field('Environment preset', control('select', 'preset', {},
          ...Object.entries(PRESETS).map(([key, value]) => option(key, value.label)), option('custom', 'Custom')), { class: 'wt-wide' })),
      element('div', { class: 'wt-checks', 'aria-label': 'Independent features' },
        ...[['language', 'Language / locale'], ['timezone', 'Timezone / Date'], ['geolocation', 'Simulated location']].map(([name, label]) =>
          element('label', {}, element('input', { type: 'checkbox', 'data-feature': name }), label))),
      element('div', { class: 'wt-grid' },
        field('Primary language', control('input', 'language', { spellcheck: 'false', placeholder: 'en-US' })),
        field('Preferred languages', control('input', 'languages', { spellcheck: 'false', placeholder: 'en-US, en' })),
        field('IANA timezone', control('input', 'timezone', { spellcheck: 'false', placeholder: 'America/Los_Angeles' }), { class: 'wt-wide' }),
        field('Latitude', control('input', 'latitude', { type: 'number', min: '-90', max: '90', step: 'any' })),
        field('Longitude', control('input', 'longitude', { type: 'number', min: '-180', max: '180', step: 'any' })),
        field('Accuracy (meters)', control('input', 'accuracy', { type: 'number', min: '0', step: 'any' }), { class: 'wt-wide' })),
      note('City coordinates are illustrative. Local Date constructors, parsing and setters retain the host timezone. Changes take effect after reload.'),
      control('p', 'message', { class: 'wt-message', role: 'status', 'aria-live': 'polite' }),
      element('div', { class: 'wt-actions' }, button('save', 'Save settings', { class: 'wt-primary' }), button('reload', 'Reload now', { hidden: '' })),
      element('div', { class: 'wt-actions' }, button('native', 'Restore native on this site'), button('reset', 'Reset all saved rules')),
      element('details', {}, element('summary', {}, 'Page diagnostics'), control('pre', 'diagnostics'),
        button('observe', 'Refresh observations'), button('test-location', 'Test simulated location'),
        control('pre', 'location-result', {}, 'Geolocation: Not tested'),
        note('Not covered: frames, Workers, Service Workers, other Intl constructors, HTTP headers, browser UI, IP location, User-Agent, Client Hints, WebRTC or network fingerprints. Browser permission state is unchanged. Cached native references and early page scripts may bypass overrides.'))
    ];
  }

  function openSettings(runtime) {
    if (runtime.panel?.isConnected) {
      runtime.panel.shadowRoot.querySelector('button').focus();
      return;
    }
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', () => openSettings(runtime), { once: true });
      return;
    }
    const latest = loadSettings();
    const settings = latest.settings;
    const origin = location.origin;
    const previousFocus = document.activeElement;
    const host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const css = `
      :host { all: initial; color-scheme: light dark; }
      * { box-sizing: border-box; }
      .wt-panel { --wt-bg: #fff; --wt-fg: #17232c; --wt-line: #d6dfe4; --wt-soft: #f1f5f7; --wt-accent: #176b55;
        position: fixed; inset: 16px 16px auto auto; z-index: 2147483647; width: min(460px, calc(100vw - 24px));
        max-height: calc(100dvh - 32px); overflow: auto; padding: 22px; border: 1px solid var(--wt-line);
        border-radius: 16px; box-shadow: 0 12px 60px #0003; background: var(--wt-bg); color: var(--wt-fg);
        font: 14px/1.5 system-ui, sans-serif; text-align: left; }
      @media (prefers-color-scheme: dark) { .wt-panel { --wt-bg: #172128; --wt-fg: #e5edf1; --wt-line: #41505a; --wt-soft: #25333c; --wt-accent: #81d7b8; } }
      @media (max-width: 500px) { .wt-panel { inset: 12px 12px auto; padding: 16px; max-height: calc(100dvh - 24px); } }
      h2 { margin: 0; font-size: 19px; line-height: 1.3; } h3 { margin: 18px 0 8px; font-size: 14px; }
      p { margin: 6px 0 12px; } .wt-muted { opacity: .8; font-size: 12px; }
      .wt-header, .wt-actions, .wt-checks { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .wt-header { justify-content: space-between; flex-wrap: nowrap; align-items: start; }
      .wt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .wt-wide { grid-column: 1 / -1; } label { display: block; font-size: 13px; }
      input:not([type=checkbox]), select { display: block; width: 100%; margin-top: 4px; padding: 8px;
        color: var(--wt-fg); background: var(--wt-bg); border: 1px solid var(--wt-line); border-radius: 7px; font: inherit; min-width: 0; }
      input[type=checkbox] { accent-color: var(--wt-accent); vertical-align: middle; margin-right: 6px; }
      .wt-checks { margin: 10px 0; } button { font: inherit; color: var(--wt-fg); background: var(--wt-soft);
        border: 1px solid var(--wt-line); border-radius: 7px; padding: 7px 11px; cursor: pointer; }
      button:hover { border-color: var(--wt-accent); } button:disabled { opacity: .5; cursor: default; }
      .wt-primary { background: var(--wt-accent); color: var(--wt-bg); font-weight: 600; }
      .wt-actions { margin-top: 14px; } .wt-status { padding: 10px; background: var(--wt-soft); border-radius: 8px; overflow-wrap: anywhere; }
      .wt-message { white-space: pre-wrap; overflow-wrap: anywhere; } .wt-error { color: #c73349; }
      @media (prefers-color-scheme: dark) { .wt-error { color: #ff9cab; } }
      details { border-top: 1px solid var(--wt-line); margin-top: 16px; padding-top: 10px; }
      summary { cursor: pointer; font-weight: 600; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 ui-monospace, monospace; }
      :focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 2px; } [hidden] { display: none; }
    `;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = css;
      root.append(style);
    }
    const panel = document.createElement('section');
    panel.className = 'wt-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'wt-title');
    panel.append(...settingsContent());
    root.append(panel);
    const find = (name) => root.querySelector(`[data-${name}]`);
    const message = (text, error = false) => {
      find('message').textContent = text;
      find('message').classList.toggle('wt-error', error);
    };
    const site = settings.sites[origin];
    const drafts = {
      site: site?.mode === 'profile' ? site.environment : settings.global.environment,
      global: settings.global.environment
    };
    let scope = 'site';
    find('version').textContent = `v${VERSION}`;
    find('status').textContent = `${origin}\nAt page start: ${runtime.effective.scope}`;
    find('master').checked = settings.enabled;
    find('rule').value = site?.mode || 'inherit';
    find('global-enabled').checked = settings.global.enabled;

    function readDraft() {
      const number = (key) => {
        const value = find(key).value.trim();
        return value === '' ? NaN : Number(value);
      };
      return {
        features: Object.fromEntries(['language', 'timezone', 'geolocation'].map((feature) => [feature, root.querySelector(`[data-feature="${feature}"]`).checked])),
        profile: {
          language: find('language').value, languages: find('languages').value.split(',').map((s) => s.trim()),
          timezone: find('timezone').value.trim(),
          geolocation: { latitude: number('latitude'), longitude: number('longitude'), accuracy: number('accuracy') }
        }
      };
    }
    function fillDraft(environment) {
      const { features, profile } = environment;
      for (const key of ['language', 'timezone', 'geolocation']) root.querySelector(`[data-feature="${key}"]`).checked = features[key];
      for (const key of ['language', 'timezone']) find(key).value = profile[key];
      find('languages').value = profile.languages.join(', ');
      for (const key of ['latitude', 'longitude', 'accuracy']) find(key).value = profile.geolocation[key];
      find('preset').value = Object.keys(PRESETS).find((key) => JSON.stringify(presetEnvironment(key).profile) === JSON.stringify(profile)) || 'custom';
    }
    function displayScope() {
      find('site-row').hidden = scope !== 'site';
      find('global-row').hidden = scope !== 'global';
      find('warning').hidden = scope !== 'global';
      fillDraft(drafts[scope]);
    }
    function diagnostics() {
      const saved = loadSettings();
      const configured = resolveEnvironment(saved.settings, origin);
      const lines = [
        `Saved rule: ${configured.scope}`, `Running at page start: ${runtime.effective.scope}`,
        `Shared page execution world: ${runtime.pageRealm ? 'Verified at initialization' : 'Unavailable — observations cannot be verified'}`,
        `Reload required: ${runtime.reloadNeeded ? 'Yes' : 'No changes saved in this page'}`
      ];
      const expected = configured.environment;
      for (const feature of ['language', 'timezone', 'geolocation']) lines.push(`${feature}: ${runtime.results[feature]}`);
      lines.push(`Configured profile (enabled features only): ${JSON.stringify(expected ? Object.fromEntries(Object.entries(expected.profile).filter(([key]) => expected.features[key === 'languages' ? 'language' : key])) : null)}`);
      if (runtime.pageRealm) {
        const page = unsafeWindow;
        function observed(label, read) {
          try { lines.push(`${label}: ${JSON.stringify(read())}`); }
          catch (error) { lines.push(`${label}: Unavailable (${error.message})`); }
        }
        observed('Observed navigator.language', () => page.navigator.language);
        observed('Observed navigator.languages', () => Array.from(page.navigator.languages));
        observed('Observed Intl.DateTimeFormat', () => page.Intl.DateTimeFormat().resolvedOptions());
        observed('Observed Intl.NumberFormat locale', () => page.Intl.NumberFormat().resolvedOptions().locale);
        observed('Observed Date offset (minutes)', () => new page.Date().getTimezoneOffset());
        observed('Observed Date local string', () => new page.Date().toString());
        observed('Observed UTC ISO string', () => new page.Date().toISOString());
        observed('Geolocation API available', () => Boolean(page.navigator.geolocation));
        observed('Geolocation policy visibility', () => {
          const policy = page.document.permissionsPolicy || page.document.featurePolicy;
          return policy?.allowsFeature ? (policy.allowsFeature('geolocation') ? 'Allowed' : 'Blocked') : 'Unavailable in this browser';
        });
      }
      if (saved.error) lines.push(saved.error);
      find('diagnostics').textContent = lines.join('\n');
    }
    function persist(next) {
      const validated = validateSettings(next);
      if (typeof GM_setValue !== 'function') throw new Error('Userscript storage is unavailable.');
      GM_setValue(SETTINGS_KEY, validated);
      // Verify synchronous persistence before claiming a successful save.
      const readback = loadSettings();
      if (readback.error || JSON.stringify(readback.settings) !== JSON.stringify(validated)) throw new Error('Settings could not be verified in persistent storage.');
      runtime.reloadNeeded = true;
      find('reload').hidden = false;
      message('Saved locally. Reload this page to apply the saved rule.');
      diagnostics();
    }
    function trustedAction(callback) {
      return (event) => {
        if (!event.isTrusted) return; // Ordinary page events must never write GM storage.
        try { callback(); }
        catch (error) { message(error.message, true); }
      };
    }
    find('scope').addEventListener('change', () => {
      drafts[scope] = readDraft();
      scope = find('scope').value;
      displayScope();
    });
    find('preset').addEventListener('change', () => {
      if (find('preset').value === 'custom') return;
      const features = readDraft().features;
      fillDraft({ ...presetEnvironment(find('preset').value), features });
    });
    for (const input of root.querySelectorAll('input:not([type=checkbox])')) {
      input.addEventListener('input', () => { find('preset').value = 'custom'; });
    }
    find('save').addEventListener('click', trustedAction(() => {
      // Merge with the latest settings so another tab's unrelated site rules survive.
      const fresh = loadSettings();
      if (fresh.error) throw new Error(`${fresh.error} Use Reset all saved rules to recover.`);
      const next = fresh.settings;
      next.enabled = find('master').checked;
      if (scope === 'global') {
        next.global = { enabled: find('global-enabled').checked, environment: validateEnvironment(readDraft()) };
      } else if (find('rule').value === 'inherit') {
        delete next.sites[origin];
      } else if (find('rule').value === 'disabled') {
        next.sites[origin] = { mode: 'disabled' };
      } else {
        next.sites[origin] = { mode: 'profile', environment: validateEnvironment(readDraft()) };
      }
      persist(next);
    }));
    find('native').addEventListener('click', trustedAction(() => {
      const fresh = loadSettings();
      if (fresh.error) throw new Error(`${fresh.error} Use Reset all saved rules to recover.`);
      fresh.settings.sites[origin] = { mode: 'disabled' };
      persist(fresh.settings);
      find('rule').value = 'disabled';
    }));
    find('reset').addEventListener('click', trustedAction(() => {
      persist(defaultSettings());
      find('master').checked = false;
      find('global-enabled').checked = false;
      find('rule').value = 'inherit';
      drafts.site = presetEnvironment(); drafts.global = presetEnvironment();
      displayScope();
    }));
    find('reload').hidden = !runtime.reloadNeeded;
    find('reload').addEventListener('click', trustedAction(() => location.reload()));
    find('observe').addEventListener('click', diagnostics);
    const simulatedGetter = runtime.simulatedGetter;
    find('test-location').addEventListener('click', trustedAction(() => {
      if (!simulatedGetter || unsafeWindow.navigator.geolocation?.getCurrentPosition !== simulatedGetter) {
        find('location-result').textContent = 'Geolocation: Not tested. Enable simulated location and reload; the page API must still use the installed override.';
        return;
      }
      find('location-result').textContent = 'Geolocation: Test pending…';
      Reflect.apply(simulatedGetter, unsafeWindow.navigator.geolocation, [
        (position) => { if (host.isConnected) find('location-result').textContent = `Observed page API coordinates: ${JSON.stringify(position)}`; },
        (error) => { if (host.isConnected) find('location-result').textContent = `Geolocation: Failed (${error.message})`; }
      ]);
    }));
    function close() {
      host.remove(); runtime.panel = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
    find('close').addEventListener('click', close);
    // Handle only events inside this panel; the rest of the page keeps its handlers.
    for (const name of ['keydown', 'keyup', 'click', 'pointerdown', 'pointerup', 'input', 'change']) {
      root.addEventListener(name, (event) => {
        if (name === 'keydown' && event.key === 'Escape') { event.preventDefault(); close(); }
        event.stopPropagation();
      });
    }
    displayScope();
    diagnostics();
    if (latest.error || runtime.loaded.error) message(latest.error || runtime.loaded.error, true);
    else if (!runtime.pageRealm) message('Page execution world is unavailable. No overrides were applied. Check the userscript manager injection mode and reload.', true);
    else if (runtime.reloadNeeded) message('Saved settings differ from this page startup. Reload to apply them.');
    document.documentElement.append(host);
    runtime.panel = host;
    find('close').focus({ preventScroll: true });
  }

  initialize();
})();
