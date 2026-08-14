// ==UserScript==
// @name         ChatGPT Account Usage Dashboard
// @name:zh-CN   ChatGPT 账户用量浮窗
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.1.0
// @description  Display the current ChatGPT account plan, Codex limits, credits, and usage analytics in a private floating dashboard.
// @description:zh-CN 在 ChatGPT 页面显示当前账号套餐、Codex 额度、Credits 与使用统计。
// @author       KnowSky404
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/KnowSky404/WebTweaks
// @supportURL   https://github.com/KnowSky404/WebTweaks/issues
// @updateURL    https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/chatgpt-com/account-usage-dashboard.user.js
// @downloadURL  https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/chatgpt-com/account-usage-dashboard.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '1.1.0';
  const HOST_ID = 'wt-chatgpt-account-usage-host';
  const SESSION_ENDPOINT = '/api/auth/session';
  const USAGE_ENDPOINT = '/backend-api/wham/usage';
  const ANALYTICS_ENDPOINT = '/backend-api/wham/analytics/daily-workspace-usage-counts';
  const ANALYTICS_URL = 'https://chatgpt.com/codex/cloud/settings/analytics';
  const REQUEST_TIMEOUT_MS = 8000;
  const REFRESH_OPTIONS = [0, 60_000, 300_000, 600_000, 1_800_000];
  const RANGE_OPTIONS = ['cycle', 'month', '7d', '30d'];
  const PREF_KEYS = {
    position: 'wt-chatgpt-account-usage:position',
    collapsed: 'wt-chatgpt-account-usage:collapsed',
    range: 'wt-chatgpt-account-usage:range',
    refresh: 'wt-chatgpt-account-usage:refresh-interval',
    email: 'wt-chatgpt-account-usage:show-email',
    metric: 'wt-chatgpt-account-usage:chart-metric'
  };
  const DEFAULT_PREFS = {
    position: null,
    collapsed: true,
    range: 'cycle',
    refresh: 300_000,
    email: true,
    metric: 'tokens'
  };

  const runtime = {
    host: null,
    shadow: null,
    app: null,
    prefs: loadPreferences(),
    state: createInitialState(),
    inFlight: new Map(),
    refreshPromise: null,
    refreshTimer: null,
    abortController: null,
    observers: [],
    bodyObserver: null,
    lifecycleReady: false,
    accountFingerprint: null,
    originalPushState: null,
    originalReplaceState: null,
    visibilityHandler: null
  };

  function createInitialState() {
    return {
      loading: true,
      signedIn: null,
      data: null,
      stale: false,
      error: null,
      analyticsError: null,
      fetchedAt: null,
      diagnostics: {
        usageStatus: null,
        analyticsStatus: null,
        usageMode: 'cookie-only',
        windowCount: 0,
        primaryWindowCount: 0,
        additionalWindowCount: 0,
        windows: [],
        dailyRows: 0,
        clientTypes: [],
        unknownFields: [],
        errors: []
      }
    };
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function firstDefined(object, paths) {
    for (const path of paths) {
      const parts = path.split('.');
      let value = object;
      for (const part of parts) {
        if (!isRecord(value) && !Array.isArray(value)) {
          value = undefined;
          break;
        }
        value = value[part];
      }
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return null;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
      return null;
    }
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function boolOrNull(value) {
    return typeof value === 'boolean' ? value : null;
  }

  function clampPercent(value) {
    const number = numberOrNull(value);
    return number === null ? null : Math.min(100, Math.max(0, number));
  }

  function parseTimestamp(value) {
    const number = numberOrNull(value);
    if (number !== null) {
      const milliseconds = Math.abs(number) < 100_000_000_000 ? number * 1000 : number;
      return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function prettyName(value, fallback = '未命名') {
    if (typeof value !== 'string' || !value.trim()) {
      return fallback;
    }
    return value.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatNumber(value) {
    const number = numberOrNull(value);
    return number === null ? '未提供' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number);
  }

  function formatPercent(value) {
    const number = clampPercent(value);
    return number === null ? '未提供' : `${number.toFixed(number % 1 ? 1 : 0)}%`;
  }

  function formatDate(value) {
    const timestamp = parseTimestamp(value);
    return timestamp === null ? '未提供' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
  }

  function formatDuration(seconds) {
    const number = numberOrNull(seconds);
    if (number === null || number < 0) {
      return '未提供';
    }
    const totalMinutes = Math.floor(number / 60);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days) return `${days}天${hours}小时`;
    if (hours) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
  }

  function formatCountdown(resetAt, now = Date.now()) {
    const timestamp = parseTimestamp(resetAt);
    if (timestamp === null) return '未提供';
    const seconds = Math.max(0, Math.floor((timestamp - now) / 1000));
    return seconds ? `还有 ${formatDuration(seconds)}` : '即将重置';
  }

  function formatRefresh(value) {
    if (!value) return '关闭';
    return `${Math.round(value / 60_000)} 分钟`;
  }

  function dateKeyUTC(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  function todayKeyUTC() {
    return dateKeyUTC(Date.now());
  }

  function addDays(dateKey, days) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function daysFromNowUTC(days) {
    return addDays(todayKeyUTC(), days);
  }

  function sumOptional(values) {
    const numbers = values.map(numberOrNull).filter((value) => value !== null);
    return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
  }

  function mergeMetricValues(left, right) {
    const result = {};
    for (const key of ['credits', 'tokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'threads', 'turns']) {
      result[key] = sumOptional([left && left[key], right && right[key]]);
    }
    return result;
  }

  function normalizeMetrics(value) {
    const source = isRecord(value) ? value : {};
    const metrics = {
      credits: numberOrNull(firstDefined(source, ['credits', 'total_credits', 'totalCredits'])),
      tokens: numberOrNull(firstDefined(source, ['tokens', 'total_tokens', 'totalTokens'])),
      cachedInputTokens: numberOrNull(firstDefined(source, ['cached_input_tokens', 'cachedInputTokens', 'cached_text_input_tokens'])),
      uncachedInputTokens: numberOrNull(firstDefined(source, ['uncached_input_tokens', 'uncachedInputTokens', 'uncached_text_input_tokens'])),
      outputTokens: numberOrNull(firstDefined(source, ['output_tokens', 'outputTokens', 'text_output_tokens'])),
      threads: numberOrNull(firstDefined(source, ['threads', 'thread_count', 'threadCount'])),
      turns: numberOrNull(firstDefined(source, ['turns', 'turn_count', 'turnCount']))
    };
    if (metrics.tokens === null) {
      metrics.tokens = sumOptional([metrics.cachedInputTokens, metrics.uncachedInputTokens, metrics.outputTokens]);
    }
    return metrics;
  }

  function readPreference(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  function writePreference(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // Private browsing and disabled storage are valid environments.
    }
  }

  function loadPreferences() {
    const position = readPreference(PREF_KEYS.position, DEFAULT_PREFS.position);
    return {
      position: isRecord(position) && numberOrNull(position.left) !== null && numberOrNull(position.top) !== null ? position : null,
      collapsed: readPreference(PREF_KEYS.collapsed, DEFAULT_PREFS.collapsed) !== false,
      range: RANGE_OPTIONS.includes(readPreference(PREF_KEYS.range, DEFAULT_PREFS.range)) ? readPreference(PREF_KEYS.range, DEFAULT_PREFS.range) : DEFAULT_PREFS.range,
      refresh: REFRESH_OPTIONS.includes(numberOrNull(readPreference(PREF_KEYS.refresh, DEFAULT_PREFS.refresh))) ? numberOrNull(readPreference(PREF_KEYS.refresh, DEFAULT_PREFS.refresh)) : DEFAULT_PREFS.refresh,
      email: readPreference(PREF_KEYS.email, DEFAULT_PREFS.email) !== false,
      metric: readPreference(PREF_KEYS.metric, DEFAULT_PREFS.metric) === 'credits' ? 'credits' : 'tokens'
    };
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  async function requestJSON(url, options = {}) {
    const key = `${url}|${options.headers && options.headers.Authorization ? 'auth' : 'cookie'}`;
    if (runtime.inFlight.has(key)) return runtime.inFlight.get(key);
    const promise = (async () => {
      const controller = options.controller || new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json', ...(options.headers || {}) },
          signal: controller.signal
        });
        const text = await response.text();
        return { ok: response.ok, status: response.status, data: safeJsonParse(text) };
      } catch (error) {
        return { ok: false, status: 0, data: null, error: error && error.name === 'AbortError' ? 'timeout' : 'network' };
      } finally {
        clearTimeout(timer);
        runtime.inFlight.delete(key);
      }
    })();
    runtime.inFlight.set(key, promise);
    return promise;
  }

  function getAccessToken(session) {
    return firstDefined(session, ['accessToken', 'access_token', 'user.accessToken', 'user.access_token', 'session.accessToken', 'session.access_token']);
  }

  function getAccountId(session, token) {
    const direct = firstDefined(session, ['account.id', 'activeAccount.id', 'user.account.id', 'user.account_id', 'accountId', 'activeAccountId']);
    if (typeof direct === 'string' && direct.trim()) return direct;
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    try {
      const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(decodeURIComponent(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))
        .split('').map((character) => `%${(`00${character.charCodeAt(0).toString(16)}`).slice(-2)}`).join('')));
      const candidate = firstDefined(payload, ['https://api.openai.com/auth.chatgpt_account_id', 'chatgpt_account_id', 'account_id']);
      return typeof candidate === 'string' && candidate.trim() ? candidate : null;
    } catch (_error) {
      return null;
    }
  }

  function getSessionIdentity(session) {
    if (session === null || session === undefined) {
      return { signedIn: null, displayName: null, email: null, user: {} };
    }
    const user = isRecord(session && session.user) ? session.user : {};
    const name = firstDefined(session, ['user.name', 'user.displayName', 'name', 'displayName']);
    const email = firstDefined(session, ['user.email', 'email']);
    const signedIn = Boolean(name) || Boolean(email) || Boolean(firstDefined(session, ['user.id', 'user.sub', 'account.id']));
    return { signedIn, displayName: typeof name === 'string' ? name : null, email: typeof email === 'string' ? email : null, user };
  }

  function maskEmail(email) {
    if (typeof email !== 'string' || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    if (!local || !domain) return null;
    return `${local.slice(0, 2)}${local.length > 2 ? '***' : '*'}@${domain}`;
  }

  function unwrapData(payload) {
    if (isRecord(payload) && isRecord(payload.data)) return payload.data;
    return payload;
  }

  function planLabel(rawType) {
    const key = typeof rawType === 'string' ? rawType.toLowerCase() : '';
    const labels = {
      free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro Lite', business: 'Business', team: 'Business',
      enterprise: 'Enterprise', enterprise_cbp: 'Enterprise', enterprise_cbp_usage_based: 'Enterprise', edu: 'Edu'
    };
    return labels[key] || (rawType ? prettyName(String(rawType)) : '未提供');
  }

  function planDescription(rawType) {
    const key = typeof rawType === 'string' ? rawType.toLowerCase() : '';
    const descriptions = {
      prolite: 'Pro 较低用量档',
      pro: 'Pro 高用量档',
      plus: 'Plus 订阅档',
      free: '免费档位',
      go: 'Go 订阅档',
      business: 'Business 工作区档位',
      team: 'Business 工作区档位',
      enterprise: 'Enterprise 工作区档位',
      edu: 'Edu 教育档位'
    };
    return descriptions[key] || null;
  }

  function durationSeconds(source) {
    const seconds = numberOrNull(firstDefined(source, ['limit_window_seconds', 'limitWindowSeconds', 'duration_seconds', 'durationSeconds', 'window_seconds', 'windowSeconds']));
    if (seconds !== null) return seconds;
    const minutes = numberOrNull(firstDefined(source, ['window_minutes', 'windowMinutes', 'duration_minutes', 'durationMinutes']));
    return minutes === null ? null : minutes * 60;
  }

  const WINDOW_FIELDS = [
    'used_percent', 'usedPercent', 'remaining_percent', 'remainingPercent',
    'limit_window_seconds', 'limitWindowSeconds', 'window_minutes', 'windowMinutes',
    'reset_at', 'resetAt', 'reset_after_seconds', 'resetAfterSeconds'
  ];

  function hasWindowField(value) {
    return isRecord(value) && WINDOW_FIELDS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  function readBoolean(source, paths) {
    return boolOrNull(firstDefined(source, paths));
  }

  function limitContext(source, context) {
    if (!isRecord(source)) return context;
    return {
      ...context,
      feature: firstDefined(source, ['metered_feature', 'meteredFeature', 'feature', 'feature_name', 'featureName', 'limit_id', 'limitId']) || context.feature || null,
      label: firstDefined(source, ['limit_name', 'limitName', 'label', 'name', 'title']) || context.label || null,
      parentAllowed: readBoolean(source, ['allowed', 'is_allowed', 'isAllowed']) ?? context.parentAllowed ?? null,
      parentLimitReached: readBoolean(source, ['limit_reached', 'limitReached']) ?? context.parentLimitReached ?? null
    };
  }

  function periodLabel(duration) {
    if (duration === null) return null;
    if (duration >= 4 * 3600 && duration <= 6 * 3600) return '5 小时额度';
    if (duration >= 6 * 86400 && duration <= 8 * 86400) return '7 天额度';
    if (duration >= 86400) return `${Math.max(1, Math.round(duration / 86400))} 天额度`;
    return `${Math.max(1, Math.round(duration / 3600))} 小时额度`;
  }

  function windowLabel(source, context) {
    const durationLabel = periodLabel(durationSeconds(source));
    if (context.scope === 'additional') return `${context.label || '额外额度'}${durationLabel ? ` · ${durationLabel}` : ''}`;
    return durationLabel || context.label || '主额度';
  }

  function normalizeWindow(source, context, now = Date.now()) {
    if (!hasWindowField(source)) return null;
    let used = clampPercent(firstDefined(source, ['used_percent', 'usedPercent']));
    let remaining = clampPercent(firstDefined(source, ['remaining_percent', 'remainingPercent']));
    if (used === null && remaining !== null) used = 100 - remaining;
    if (remaining === null && used !== null) remaining = 100 - used;
    const duration = durationSeconds(source);
    const resetAfter = numberOrNull(firstDefined(source, ['reset_after_seconds', 'resetAfterSeconds']));
    const explicitReset = parseTimestamp(firstDefined(source, ['reset_at', 'resetAt']));
    const resetAt = explicitReset === null && resetAfter !== null ? now + resetAfter * 1000 : explicitReset;
    return {
      id: `${context.scope}:${context.feature || ''}:${context.sourcePath}:${duration || ''}:${resetAt || ''}`,
      scope: context.scope,
      feature: firstDefined(source, ['feature', 'feature_name', 'featureName']) || context.feature || null,
      label: windowLabel(source, context),
      durationSeconds: duration,
      usedPercent: used,
      remainingPercent: remaining,
      resetAt,
      resetAfterSeconds: resetAfter,
      limitReached: readBoolean(source, ['limit_reached', 'limitReached']) ?? context.parentLimitReached ?? null,
      allowed: readBoolean(source, ['allowed', 'is_allowed', 'isAllowed']) ?? context.parentAllowed ?? null,
      sourcePath: context.sourcePath
    };
  }

  function collectWindowPair(container, context, windows, now) {
    if (!isRecord(container)) return;
    const pair = [
      ['primary_window', 'primaryWindow'],
      ['secondary_window', 'secondaryWindow']
    ];
    for (const [snake, camel] of pair) {
      const key = Object.prototype.hasOwnProperty.call(container, snake) ? snake : camel;
      if (!Object.prototype.hasOwnProperty.call(container, key) || !isRecord(container[key])) continue;
      const windowContext = { ...context, sourcePath: `${context.sourcePath}.${key}` };
      const normalized = normalizeWindow(container[key], windowContext, now);
      if (normalized) windows.push(normalized);
    }
  }

  function collectLimitContainer(container, context, windows, now) {
    if (Array.isArray(container)) {
      container.forEach((item, index) => collectLimitContainer(item, { ...context, sourcePath: `${context.sourcePath}[${index}]` }, windows, now));
      return;
    }
    if (!isRecord(container)) return;
    const nextContext = limitContext(container, context);
    const hasPair = ['primary_window', 'primaryWindow', 'secondary_window', 'secondaryWindow'].some((key) => Object.prototype.hasOwnProperty.call(container, key));
    collectWindowPair(container, nextContext, windows, now);
    if (hasPair) return;
    const nestedKey = Object.prototype.hasOwnProperty.call(container, 'rate_limit') ? 'rate_limit' : Object.prototype.hasOwnProperty.call(container, 'rateLimit') ? 'rateLimit' : null;
    if (nestedKey && isRecord(container[nestedKey])) {
      collectLimitContainer(container[nestedKey], { ...nextContext, sourcePath: `${context.sourcePath}.${nestedKey}` }, windows, now);
      return;
    }
    if (hasWindowField(container)) {
      const normalized = normalizeWindow(container, nextContext, now);
      if (normalized) windows.push(normalized);
      return;
    }
    for (const [key, value] of Object.entries(container)) {
      if (!isRecord(value) && !Array.isArray(value)) continue;
      collectLimitContainer(value, { ...context, sourcePath: `${context.sourcePath}.${key}` }, windows, now);
    }
  }

  function collectUsageWindows(usage, now = Date.now()) {
    const windows = [];
    collectWindowPair(usage, { scope: 'primary', feature: null, label: null, sourcePath: 'usage', parentAllowed: null, parentLimitReached: null }, windows, now);
    const rateLimit = firstDefined(usage, ['rate_limit', 'rateLimit']);
    if (rateLimit) collectLimitContainer(rateLimit, { scope: 'primary', feature: null, label: null, sourcePath: 'rate_limit', parentAllowed: null, parentLimitReached: null }, windows, now);
    const rateLimits = firstDefined(usage, ['rate_limits', 'rateLimits']);
    if (rateLimits) collectLimitContainer(rateLimits, { scope: 'primary', feature: null, label: null, sourcePath: 'rate_limits', parentAllowed: null, parentLimitReached: null }, windows, now);
    const additional = firstDefined(usage, ['additional_rate_limits', 'additionalRateLimits']);
    if (additional) collectLimitContainer(additional, { scope: 'additional', feature: null, label: null, sourcePath: 'additional_rate_limits', parentAllowed: null, parentLimitReached: null }, windows, now);
    return windows.filter((item, index, all) => all.findIndex((candidate) => [candidate.scope, candidate.feature, candidate.sourcePath, candidate.durationSeconds, candidate.resetAt].join('|') === [item.scope, item.feature, item.sourcePath, item.durationSeconds, item.resetAt].join('|')) === index);
  }

  function normalizeUsage(payload, session, fetchedAt) {
    const usage = unwrapData(payload);
    if (!isRecord(usage)) throw new Error('schema');
    const identity = getSessionIdentity(session);
    const windows = collectUsageWindows(usage, fetchedAt);
    const rawType = firstDefined(usage, ['plan_type', 'planType']);
    const credits = unwrapData(firstDefined(usage, ['credits', 'credit_status', 'creditStatus'])) || {};
    const resetCredits = unwrapData(firstDefined(usage, ['rate_limit_reset_credits', 'rateLimitResetCredits'])) || {};
    const spend = unwrapData(firstDefined(usage, ['spend_control', 'spendControl'])) || {};
    const mainRateLimit = firstDefined(usage, ['rate_limit', 'rateLimit']);
    const topAllowed = readBoolean(usage, ['allowed', 'is_allowed', 'isAllowed']);
    const topLimitReached = readBoolean(usage, ['limit_reached', 'limitReached']);
    const allowed = topAllowed ?? (isRecord(mainRateLimit) ? readBoolean(mainRateLimit, ['allowed', 'is_allowed', 'isAllowed']) : null) ?? windows.find((item) => item.scope === 'primary' && item.allowed !== null)?.allowed ?? null;
    const limitReached = topLimitReached ?? (isRecord(mainRateLimit) ? readBoolean(mainRateLimit, ['limit_reached', 'limitReached']) : null) ?? windows.find((item) => item.scope === 'primary' && item.limitReached !== null)?.limitReached ?? null;
    const resetAt = parseTimestamp(firstDefined(spend, ['reset_at', 'resetAt']));
    const spendUsed = numberOrNull(firstDefined(spend, ['used']));
    const spendLimit = numberOrNull(firstDefined(spend, ['limit']));
    const spendUsedPercent = clampPercent(firstDefined(spend, ['used_percent', 'usedPercent']));
    const spendRemainingPercent = clampPercent(firstDefined(spend, ['remaining_percent', 'remainingPercent']));
    return {
      session: { signedIn: identity.signedIn, displayName: identity.displayName, maskedEmail: maskEmail(identity.email) },
      plan: { rawType: rawType === null ? null : String(rawType), label: planLabel(rawType), allowed, limitReached },
      windows,
      credits: {
        hasCredits: boolOrNull(firstDefined(credits, ['has_credits', 'hasCredits'])),
        unlimited: boolOrNull(firstDefined(credits, ['unlimited'])),
        balance: numberOrNull(firstDefined(credits, ['balance', 'remaining'])),
        resetCreditsAvailable: numberOrNull(firstDefined(resetCredits, ['available_count', 'availableCount']))
      },
      spendControl: {
        reached: boolOrNull(firstDefined(spend, ['reached', 'limit_reached', 'limitReached'])),
        used: spendUsed,
        limit: spendLimit,
        usedPercent: spendUsedPercent,
        remainingPercent: spendRemainingPercent,
        resetAt
      },
      analytics: { dailyRows: [], clientRows: [], ranges: {} },
      fetchedAt,
      partial: false,
      stale: false,
      errors: []
    };
  }

  function unknownUsageFields(usage) {
    const known = new Set([
      'data', 'plan_type', 'planType', 'rate_limit', 'rateLimit', 'rate_limits', 'rateLimits', 'primary_window', 'primaryWindow',
      'secondary_window', 'secondaryWindow', 'additional_rate_limits', 'additionalRateLimits', 'allowed', 'is_allowed', 'isAllowed',
      'limit_reached', 'limitReached', 'credits', 'credit_status', 'creditStatus', 'rate_limit_reset_credits', 'rateLimitResetCredits',
      'spend_control', 'spendControl'
    ]);
    return Object.keys(usage).filter((key) => !known.has(key)).slice(0, 20);
  }

  function normalizeDailyRows(payload) {
    const root = unwrapData(payload);
    const candidates = Array.isArray(root) ? root : asArray(firstDefined(root, ['data', 'daily', 'rows', 'daily_rows', 'dailyRows', 'usage']));
    return candidates.map((item) => {
      if (!isRecord(item)) return null;
      const rawDate = firstDefined(item, ['date', 'day', 'usage_date', 'usageDate']);
      const date = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : dateKeyUTC(parseTimestamp(rawDate));
      const totals = mergeMetricValues(normalizeMetrics(firstDefined(item, ['totals', 'total'])), normalizeMetrics(item));
      const clients = asArray(firstDefined(item, ['clients', 'client_usage', 'clientUsage'])).map((client) => {
        if (!isRecord(client)) return null;
        return { clientId: String(firstDefined(client, ['client_id', 'clientId', 'id', 'name']) || 'UNKNOWN'), metrics: mergeMetricValues(normalizeMetrics(firstDefined(client, ['totals', 'total'])), normalizeMetrics(client)) };
      }).filter(Boolean);
      return date ? { date, metrics: totals, clients } : null;
    }).filter(Boolean);
  }

  function aggregateRows(rows, startDate, endDate) {
    const selected = rows.filter((row) => row.date >= startDate && row.date < endDate);
    const metrics = selected.reduce((total, row) => mergeMetricValues(total, row.metrics), normalizeMetrics({}));
    return { ...metrics, dates: selected.length, rows: selected };
  }

  function deriveRanges(rows, windows, now = Date.now()) {
    const monthStart = `${new Date(now).getUTCFullYear()}-${String(new Date(now).getUTCMonth() + 1).padStart(2, '0')}-01`;
    const thirtyStart = daysFromNowUTC(-30);
    const longWindow = windows.filter((item) => item.durationSeconds && item.durationSeconds >= 24 * 3600).sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0))[0] || windows[0];
    const cycleStart = longWindow && longWindow.resetAt && longWindow.durationSeconds ? dateKeyUTC(longWindow.resetAt - longWindow.durationSeconds * 1000) : thirtyStart;
    const end = daysFromNowUTC(1);
    return {
      cycle: { label: '当前周期', start: cycleStart || thirtyStart, end, stats: aggregateRows(rows, cycleStart || thirtyStart, end) },
      month: { label: '本月', start: monthStart, end, stats: aggregateRows(rows, monthStart, end) },
      '7d': { label: '最近 7 天', start: daysFromNowUTC(-7), end, stats: aggregateRows(rows, daysFromNowUTC(-7), end) },
      '30d': { label: '最近 30 天', start: thirtyStart, end, stats: aggregateRows(rows, thirtyStart, end) }
    };
  }

  function aggregateClients(rows, startDate, endDate) {
    const map = new Map();
    for (const row of rows) {
      if (row.date < startDate || row.date >= endDate) continue;
      for (const client of row.clients) {
        const previous = map.get(client.clientId) || normalizeMetrics({});
        map.set(client.clientId, mergeMetricValues(previous, client.metrics));
      }
    }
    const totalTokens = sumOptional([...map.values()].map((metrics) => metrics.tokens)) || 0;
    return [...map.entries()].map(([clientId, metrics]) => ({ clientId, ...metrics, tokenShare: totalTokens ? (metrics.tokens || 0) / totalTokens * 100 : null })).sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
  }

  function analyticsRequestRange(windows, now = Date.now()) {
    const monthStart = `${new Date(now).getUTCFullYear()}-${String(new Date(now).getUTCMonth() + 1).padStart(2, '0')}-01`;
    const thirtyStart = daysFromNowUTC(-30);
    const starts = [monthStart, thirtyStart];
    for (const window of windows) {
      if (window.resetAt && window.durationSeconds) starts.push(dateKeyUTC(window.resetAt - window.durationSeconds * 1000));
    }
    return { start: starts.filter(Boolean).sort()[0] || thirtyStart, end: daysFromNowUTC(1) };
  }

  function errorMessage(result, analytics = false) {
    if (!result) return analytics ? '详细统计暂不可用' : '暂时无法读取用量';
    if (result.status === 401) return '请先登录 ChatGPT';
    if (result.status === 403) return analytics ? '当前账号或套餐未提供详细 Analytics' : '当前账号可能无权访问用量接口';
    if (result.status === 404) return analytics ? '内部 Analytics 接口可能已经调整' : '用量接口可能已经调整';
    if (result.status === 429) return '请求过于频繁，请稍后再试';
    if (result.error === 'timeout') return '请求超时';
    if (result.error === 'network') return '网络请求失败';
    return analytics ? '详细统计暂不可用' : '用量数据暂不可用';
  }

  async function getUsageWithFallback(controller) {
    const cookieResult = await requestJSON(USAGE_ENDPOINT, { controller });
    if (cookieResult.ok || (cookieResult.status !== 401 && cookieResult.status !== 403)) return { result: cookieResult, session: null, headers: {}, mode: 'cookie-only' };
    const sessionResult = await requestJSON(SESSION_ENDPOINT, { controller });
    if (!sessionResult.ok) return { result: cookieResult, session: null, headers: {}, mode: 'cookie-only' };
    const token = getAccessToken(sessionResult.data);
    const accountId = getAccountId(sessionResult.data, token);
    const headers = {};
    if (typeof token === 'string' && token.trim()) headers.Authorization = `Bearer ${token}`;
    if (typeof accountId === 'string' && accountId.trim()) headers['ChatGPT-Account-Id'] = accountId;
    if (!Object.keys(headers).length) return { result: cookieResult, session: sessionResult.data, headers, mode: 'cookie-only' };
    const authenticated = await requestJSON(USAGE_ENDPOINT, { controller, headers });
    return { result: authenticated, session: sessionResult.data, headers, mode: 'authenticated-fallback' };
  }

  async function refresh() {
    if (runtime.refreshPromise) return runtime.refreshPromise;
    runtime.refreshPromise = (async () => {
      runtime.state.loading = !runtime.state.data;
      runtime.state.error = null;
      render();
      if (runtime.abortController) runtime.abortController.abort();
      runtime.abortController = new AbortController();
      const startedAt = Date.now();
      const usageTask = getUsageWithFallback(runtime.abortController);
      const sessionTask = requestJSON(SESSION_ENDPOINT, { controller: runtime.abortController });
      const usageBundle = await usageTask;
      const sessionResult = await sessionTask;
      const session = usageBundle.session || (sessionResult.ok ? sessionResult.data : null);
      runtime.state.diagnostics.usageStatus = usageBundle.result.status;
      runtime.state.diagnostics.usageMode = usageBundle.mode;
      if (!usageBundle.result.ok || !usageBundle.result.data) {
        runtime.state.loading = false;
        runtime.state.stale = Boolean(runtime.state.data);
        runtime.state.error = errorMessage(usageBundle.result);
        runtime.state.signedIn = usageBundle.result.status !== 401 && sessionResult.status !== 401 ? null : false;
        runtime.state.diagnostics.errors = [usageBundle.result.status || usageBundle.result.error || 'usage'];
        render();
        return;
      }
      let normalized;
      try {
        normalized = normalizeUsage(usageBundle.result.data, session, startedAt);
      } catch (_error) {
        runtime.state.loading = false;
        runtime.state.error = '接口返回结构暂无法识别';
        runtime.state.stale = Boolean(runtime.state.data);
        render();
        return;
      }
      const identity = getSessionIdentity(session);
      const accountId = getAccountId(session, getAccessToken(session));
      const fingerprint = accountId || firstDefined(session, ['user.id', 'user.sub']) || (identity.email ? `email:${identity.email}` : null);
      if (sessionResult.status === 401 || (runtime.accountFingerprint && fingerprint && runtime.accountFingerprint !== fingerprint)) {
        runtime.state.data = null;
      }
      runtime.accountFingerprint = fingerprint;
      runtime.state.signedIn = identity.signedIn;
      if (sessionResult.status === 401) normalized.session.signedIn = false;
      runtime.state.diagnostics.unknownFields = unknownUsageFields(unwrapData(usageBundle.result.data));
      runtime.state.diagnostics.windowCount = normalized.windows.length;
      runtime.state.diagnostics.primaryWindowCount = normalized.windows.filter((item) => item.scope === 'primary').length;
      runtime.state.diagnostics.additionalWindowCount = normalized.windows.filter((item) => item.scope === 'additional').length;
      runtime.state.diagnostics.windows = normalized.windows.map((item) => ({
        label: item.label,
        sourcePath: item.sourcePath,
        durationSeconds: item.durationSeconds,
        hasUsedPercent: item.usedPercent !== null,
        hasResetAt: item.resetAt !== null
      }));
      const range = analyticsRequestRange(normalized.windows, startedAt);
      const query = new URLSearchParams({ start_date: range.start, end_date: range.end, group_by: 'day' });
      const analyticsResult = await requestJSON(`${ANALYTICS_ENDPOINT}?${query.toString()}`, { controller: runtime.abortController, headers: usageBundle.headers });
      runtime.state.diagnostics.analyticsStatus = analyticsResult.status;
      if (analyticsResult.ok && analyticsResult.data) {
        const rows = normalizeDailyRows(analyticsResult.data);
        normalized.analytics.dailyRows = rows;
        normalized.analytics.ranges = deriveRanges(rows, normalized.windows, startedAt);
        const selectedRange = normalized.analytics.ranges[runtime.prefs.range] || normalized.analytics.ranges['30d'];
        normalized.analytics.clientRows = aggregateClients(rows, selectedRange.start, selectedRange.end);
        runtime.state.analyticsError = null;
        runtime.state.diagnostics.dailyRows = rows.length;
        runtime.state.diagnostics.clientTypes = normalized.analytics.clientRows.map((item) => item.clientId);
      } else {
        normalized.partial = true;
        normalized.errors.push(errorMessage(analyticsResult, true));
        runtime.state.analyticsError = errorMessage(analyticsResult, true);
        runtime.state.diagnostics.errors = [analyticsResult.status || analyticsResult.error || 'analytics'];
      }
      runtime.state.data = normalized;
      runtime.state.fetchedAt = startedAt;
      runtime.state.loading = false;
      runtime.state.stale = false;
      runtime.state.error = null;
      render();
    })().catch((error) => {
      if (error && error.name === 'AbortError') return;
      runtime.state.loading = false;
      runtime.state.stale = Boolean(runtime.state.data);
      runtime.state.error = '刷新失败';
      render();
    }).finally(() => {
      runtime.refreshPromise = null;
      scheduleRefresh();
    });
    return runtime.refreshPromise;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setAttributes(node, attributes) {
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== null && value !== undefined) node.setAttribute(name, String(value));
    }
    return node;
  }

  function section(title) {
    const node = el('section', 'wt-section');
    node.append(el('h3', 'wt-section-title', title));
    return node;
  }

  function field(label, value, className = '') {
    const row = el('div', `wt-field ${className}`.trim());
    row.append(el('span', 'wt-field-label', label), el('strong', 'wt-field-value', value === undefined || value === null || value === '' ? '未提供' : value));
    return row;
  }

  function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function appendFieldIfValue(parent, label, value, className = '') {
    if (hasValue(value)) parent.append(field(label, value, className));
  }

  function statusBadge(text, kind = '') {
    return el('span', `wt-badge ${kind ? `wt-badge-${kind}` : ''}`.trim(), text);
  }

  function createProgress(value, label) {
    const wrapper = el('div', 'wt-progress-wrap');
    const bar = setAttributes(el('div', 'wt-progress'), { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 });
    const percent = clampPercent(value);
    if (percent !== null) {
      bar.style.setProperty('--wt-progress', `${percent}%`);
      bar.setAttribute('aria-valuenow', String(percent));
    }
    wrapper.append(bar);
    return wrapper;
  }

  function renderWindow(window) {
    const card = el('article', 'wt-window');
    const heading = el('div', 'wt-window-heading');
    heading.append(el('strong', 'wt-window-label', window.label), statusBadge(window.limitReached === true ? '已达到限制' : window.allowed === false ? '不可用' : '可用', window.limitReached === true ? 'danger' : 'ok'));
    const meta = `${window.scope === 'additional' ? '额外额度' : '主额度'}${window.durationSeconds !== null ? ` · 周期 ${formatDuration(window.durationSeconds)}` : ''}`;
    card.append(heading, el('div', 'wt-window-meta', meta));
    if (window.usedPercent === null && window.remainingPercent === null) {
      card.append(el('p', 'wt-window-meta wt-window-percent-unknown', '接口未提供使用比例'));
    }
    card.append(createProgress(window.usedPercent, `${window.label} 已使用百分比`));
    const grid = el('div', 'wt-field-grid');
    appendFieldIfValue(grid, '已使用', window.usedPercent === null ? null : formatPercent(window.usedPercent));
    appendFieldIfValue(grid, '剩余', window.remainingPercent === null ? null : formatPercent(window.remainingPercent));
    appendFieldIfValue(grid, '重置时间', window.resetAt === null ? null : formatDate(window.resetAt));
    appendFieldIfValue(grid, '倒计时', window.resetAt === null ? null : formatCountdown(window.resetAt));
    if (!grid.children.length && window.allowed === null && window.limitReached === null) grid.append(el('p', 'wt-empty', '接口未提供可显示的窗口详情'));
    card.append(grid);
    return card;
  }

  function renderAccount(data) {
    const node = section('当前账户');
    appendFieldIfValue(node, '登录状态', data.session.signedIn === null ? '状态未提供' : data.session.signedIn ? '已登录' : '未登录');
    appendFieldIfValue(node, '显示名', data.session.displayName);
    if (runtime.prefs.email) appendFieldIfValue(node, '邮箱（脱敏）', data.session.maskedEmail);
    appendFieldIfValue(node, '套餐', data.plan.label);
    appendFieldIfValue(node, '套餐说明', planDescription(data.plan.rawType));
    const usageStatus = data.plan.limitReached === true ? '已达到限制' : data.plan.allowed === false ? '不可用' : data.plan.allowed === true ? '可用' : '状态未提供';
    appendFieldIfValue(node, '用量状态', usageStatus);
    appendFieldIfValue(node, '最后更新时间', formatDate(data.fetchedAt));
    return node;
  }

  function renderCredits(data) {
    const values = [data.credits.hasCredits, data.credits.unlimited, data.credits.balance, data.credits.resetCreditsAvailable, data.spendControl.reached, data.spendControl.used, data.spendControl.limit, data.spendControl.usedPercent, data.spendControl.remainingPercent, data.spendControl.resetAt];
    if (!values.some(hasValue)) return null;
    const node = section('Credits 和账户用量状态');
    const grid = el('div', 'wt-field-grid');
    appendFieldIfValue(grid, 'Credits 余额', data.credits.balance === null ? null : formatNumber(data.credits.balance));
    appendFieldIfValue(grid, '无限 Credits', data.credits.unlimited === null ? null : data.credits.unlimited ? '是' : '否');
    appendFieldIfValue(grid, '可用重置券', data.credits.resetCreditsAvailable === null ? null : formatNumber(data.credits.resetCreditsAvailable));
    appendFieldIfValue(grid, '消费限额状态', data.spendControl.reached === null ? null : data.spendControl.reached ? '已达到' : '未达到');
    appendFieldIfValue(grid, '消费限额', data.spendControl.limit === null ? null : formatNumber(data.spendControl.limit));
    appendFieldIfValue(grid, '已使用', data.spendControl.used === null ? null : formatNumber(data.spendControl.used));
    appendFieldIfValue(grid, '剩余比例', data.spendControl.remainingPercent === null ? data.spendControl.usedPercent === null ? null : formatPercent(100 - data.spendControl.usedPercent) : formatPercent(data.spendControl.remainingPercent));
    appendFieldIfValue(grid, '已使用比例', data.spendControl.usedPercent === null ? null : formatPercent(data.spendControl.usedPercent));
    appendFieldIfValue(grid, '重置时间', data.spendControl.resetAt === null ? null : formatDate(data.spendControl.resetAt));
    node.append(grid);
    return node;
  }

  function renderStats(stats) {
    const grid = el('div', 'wt-field-grid');
    grid.append(field('Credits', formatNumber(stats.credits)), field('总 Tokens', formatNumber(stats.tokens)), field('Cached input', formatNumber(stats.cachedInputTokens)), field('Uncached input', formatNumber(stats.uncachedInputTokens)), field('Output tokens', formatNumber(stats.outputTokens)), field('Threads', formatNumber(stats.threads)), field('Turns', formatNumber(stats.turns)), field('有数据的日期', formatNumber(stats.dates)));
    return grid;
  }

  function renderAnalytics(data) {
    const node = section('使用统计');
    const select = setAttributes(el('select', 'wt-select'), { 'aria-label': '统计范围' });
    for (const key of RANGE_OPTIONS) {
      const range = data.analytics.ranges[key];
      if (!range) continue;
      const option = setAttributes(el('option', '', range.label), { value: key });
      option.selected = runtime.prefs.range === key;
      select.append(option);
    }
    select.addEventListener('change', () => {
      runtime.prefs.range = select.value;
      writePreference(PREF_KEYS.range, select.value);
      if (data.analytics.dailyRows.length) {
        const range = data.analytics.ranges[select.value];
        data.analytics.clientRows = aggregateClients(data.analytics.dailyRows, range.start, range.end);
      }
      render();
    });
    node.append(select);
    if (runtime.state.analyticsError) {
      const notice = el('p', 'wt-notice wt-notice-warning', runtime.state.analyticsError);
      node.append(notice, linkButton(ANALYTICS_URL, '打开官方 Analytics'));
      return node;
    }
    const range = data.analytics.ranges[runtime.prefs.range] || data.analytics.ranges['30d'];
    if (!range || !range.stats || !data.analytics.dailyRows.length) {
      node.append(el('p', 'wt-empty', '当前账号或套餐未提供详细 Analytics'));
      return node;
    }
    node.append(renderStats(range.stats), renderClientRows(data.analytics.clientRows, range.stats.tokens), renderChart(range.stats.rows));
    return node;
  }

  function renderClientRows(rows, totalTokens) {
    const wrapper = el('div', 'wt-subsection');
    wrapper.append(el('h4', 'wt-subtitle', '客户端分布'));
    if (!rows.length) {
      wrapper.append(el('p', 'wt-empty', '暂无客户端数据'));
      return wrapper;
    }
    for (const row of rows) {
      const item = el('div', 'wt-client-row');
      item.append(el('strong', 'wt-client-name', prettyName(row.clientId, '其他未知客户端')));
      item.append(el('span', 'wt-client-value', `Tokens ${formatNumber(row.tokens)} · Credits ${formatNumber(row.credits)} · Threads ${formatNumber(row.threads)} · Turns ${formatNumber(row.turns)} · 占比 ${formatPercent(row.tokenShare)}`));
      item.append(createProgress(totalTokens ? row.tokenShare : null, `${row.clientId} Token 占比`));
      wrapper.append(item);
    }
    return wrapper;
  }

  function renderChart(rows) {
    const wrapper = el('div', 'wt-subsection');
    const heading = el('div', 'wt-subsection-heading');
    heading.append(el('h4', 'wt-subtitle', '每日趋势'));
    const select = setAttributes(el('select', 'wt-select wt-chart-select'), { 'aria-label': '图表指标' });
    for (const metric of ['tokens', 'credits']) {
      const option = setAttributes(el('option', '', metric === 'tokens' ? 'Tokens' : 'Credits'), { value: metric });
      option.selected = runtime.prefs.metric === metric;
      select.append(option);
    }
    select.addEventListener('change', () => { runtime.prefs.metric = select.value; writePreference(PREF_KEYS.metric, select.value); render(); });
    heading.append(select);
    wrapper.append(heading);
    const values = rows.map((row) => ({ date: row.date, value: numberOrNull(row.metrics[runtime.prefs.metric]) })).filter((item) => item.value !== null);
    if (!values.length) {
      wrapper.append(el('p', 'wt-empty', '当前范围没有可绘制的数据'));
      return wrapper;
    }
    const max = Math.max(...values.map((item) => item.value), 1);
    const chart = el('div', 'wt-chart');
    for (const item of values) {
      const column = el('div', 'wt-chart-column');
      const bar = el('div', 'wt-chart-bar');
      bar.style.height = `${Math.max(3, item.value / max * 100)}%`;
      bar.title = `${item.date}: ${formatNumber(item.value)}`;
      column.append(bar, el('span', 'wt-chart-label', item.date.slice(5)));
      chart.append(column);
    }
    wrapper.append(chart);
    return wrapper;
  }

  function linkButton(href, label) {
    return setAttributes(el('a', 'wt-link', label), { href, target: '_blank', rel: 'noopener noreferrer' });
  }

  function findOfficialUsageHref() {
    for (const anchor of document.querySelectorAll('a[href]')) {
      const text = `${anchor.textContent || ''} ${anchor.getAttribute('aria-label') || ''}`.trim();
      const href = anchor.href;
      if (!/usage/i.test(text) || !href || /^(javascript:|#)/i.test(href)) continue;
      try {
        if (new URL(href, location.href).origin === location.origin) return href;
      } catch (_error) {
        // An unexpected anchor URL must not affect the dashboard.
      }
    }
    return null;
  }

  function renderDiagnostics() {
    const details = el('details', 'wt-diagnostics');
    details.append(el('summary', '诊断信息'));
    const lines = [
      ['脚本版本', VERSION], ['当前路径', location.pathname], ['Usage HTTP 状态', runtime.state.diagnostics.usageStatus || '未请求'],
      ['Analytics HTTP 状态', runtime.state.diagnostics.analyticsStatus || '未请求'], ['请求模式', runtime.state.diagnostics.usageMode],
      ['获取时间', formatDate(runtime.state.fetchedAt)], ['原始 plan_type', runtime.state.data && runtime.state.data.plan.rawType],
      ['成功解析窗口数量', runtime.state.diagnostics.windowCount], ['主额度窗口数量', runtime.state.diagnostics.primaryWindowCount], ['额外额度窗口数量', runtime.state.diagnostics.additionalWindowCount], ['每日数据行数', runtime.state.diagnostics.dailyRows],
      ['客户端类型', runtime.state.diagnostics.clientTypes.join(', ') || '未提供'], ['未识别顶层字段', runtime.state.diagnostics.unknownFields.join(', ') || '无'], ['错误代码', runtime.state.diagnostics.errors.join(', ') || '无']
    ];
    for (const [label, value] of lines) details.append(field(label, value));
    for (const window of runtime.state.diagnostics.windows) {
      const summary = `${window.label} · ${window.sourcePath}`;
      details.append(field('窗口', `${summary} · 周期 ${window.durationSeconds === null ? '未提供' : `${window.durationSeconds} 秒`} · used ${window.hasUsedPercent ? '已识别' : '未提供'} · resetAt ${window.hasResetAt ? '已识别' : '未提供'}`));
    }
    const copy = el('button', 'wt-button wt-button-secondary', '复制诊断信息');
    copy.type = 'button';
    copy.dataset.action = 'copy-diagnostics';
    details.append(copy);
    return details;
  }

  function diagnosticText() {
    const lines = [
      `脚本版本: ${VERSION}`, `当前路径: ${location.pathname}`, `Usage HTTP 状态: ${runtime.state.diagnostics.usageStatus || '未请求'}`,
      `Analytics HTTP 状态: ${runtime.state.diagnostics.analyticsStatus || '未请求'}`, `请求模式: ${runtime.state.diagnostics.usageMode}`,
      `获取时间: ${formatDate(runtime.state.fetchedAt)}`, `原始 plan_type: ${runtime.state.data ? runtime.state.data.plan.rawType || '未提供' : '未提供'}`,
      `成功解析窗口数量: ${runtime.state.diagnostics.windowCount}`, `主额度窗口数量: ${runtime.state.diagnostics.primaryWindowCount}`, `额外额度窗口数量: ${runtime.state.diagnostics.additionalWindowCount}`, `每日数据行数: ${runtime.state.diagnostics.dailyRows}`,
      `客户端类型: ${runtime.state.diagnostics.clientTypes.join(', ') || '未提供'}`, `未识别顶层字段: ${runtime.state.diagnostics.unknownFields.join(', ') || '无'}`, `错误代码: ${runtime.state.diagnostics.errors.join(', ') || '无'}`
    ];
    for (const window of runtime.state.diagnostics.windows) {
      lines.push(`窗口: ${window.label} | ${window.sourcePath} | durationSeconds=${window.durationSeconds === null ? 'null' : window.durationSeconds} | usedPercent=${window.hasUsedPercent ? 'present' : 'missing'} | resetAt=${window.hasResetAt ? 'present' : 'missing'}`);
    }
    return lines.join('\n');
  }

  function usageIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    setAttributes(svg, { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    setAttributes(path, { d: 'M4 19V5m0 14h16M7 16v-4m4 4V8m4 8v-6m4 6V4', fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '1.8' });
    svg.append(path);
    return svg;
  }

  function statusKind() {
    if (runtime.state.error || runtime.state.data?.windows.some((item) => item.limitReached === true)) return 'danger';
    if (runtime.state.stale || runtime.state.analyticsError || runtime.state.loading || runtime.state.data?.windows.some((item) => item.allowed === null || item.resetAt === null)) return 'warning';
    return 'ok';
  }

  function renderCollapsedLauncher() {
    const launcher = setAttributes(el('button', 'wt-launcher wt-drag-handle'), { type: 'button', 'aria-label': '打开账户用量面板', title: '账户用量' });
    launcher.append(usageIcon(), el('span', `wt-status-dot wt-status-dot-${statusKind()}`));
    return launcher;
  }

  function renderExpandedPanel() {
    const shell = el('div', 'wt-shell');
    const header = el('div', 'wt-header wt-drag-handle');
    const title = el('div', 'wt-title-group');
    title.append(el('strong', 'wt-title', '账户用量'), el('span', 'wt-title-status', runtime.state.stale ? '数据可能已过期' : runtime.state.loading ? '读取中…' : runtime.state.error ? runtime.state.error : '就绪'));
    const toggle = setAttributes(el('button', 'wt-icon-button'), { type: 'button', 'aria-label': '收起账户用量面板', title: '收起账户用量面板', 'aria-expanded': 'true' });
    toggle.append(usageIcon());
    toggle.dataset.action = 'toggle';
    header.append(title, toggle);
    shell.append(header);
    const body = el('div', 'wt-body');
    if (runtime.state.loading && !runtime.state.data) body.append(el('div', 'wt-loading', '正在读取账户与额度…'));
    if (runtime.state.error && !runtime.state.data) body.append(el('div', 'wt-notice wt-notice-danger', runtime.state.error));
    if (runtime.state.data) {
      const credits = renderCredits(runtime.state.data);
      body.append(renderAccount(runtime.state.data));
      if (credits) body.append(credits);
      const windows = section('额度窗口');
      if (runtime.state.data.windows.length) runtime.state.data.windows.forEach((item) => windows.append(renderWindow(item)));
      else windows.append(el('p', 'wt-empty', '接口未提供有效额度窗口'));
      body.append(windows, renderAnalytics(runtime.state.data));
    }
    const actions = section('操作');
    const refresh = el('div', 'wt-action-row');
    const refreshButton = el('button', 'wt-button', '手动刷新'); refreshButton.type = 'button'; refreshButton.dataset.action = 'refresh';
    const refreshSelect = setAttributes(el('select', 'wt-select'), { 'aria-label': '自动刷新间隔' });
    for (const value of REFRESH_OPTIONS) { const option = setAttributes(el('option', '', `自动刷新：${formatRefresh(value)}`), { value }); option.selected = runtime.prefs.refresh === value; refreshSelect.append(option); }
    refreshSelect.addEventListener('change', () => { runtime.prefs.refresh = Number(refreshSelect.value); writePreference(PREF_KEYS.refresh, runtime.prefs.refresh); scheduleRefresh(); });
    refresh.append(refreshButton, refreshSelect); actions.append(refresh);
    actions.append(linkButton(ANALYTICS_URL, '打开官方 Analytics'));
    const usageHref = findOfficialUsageHref(); if (usageHref) actions.append(linkButton(usageHref, '打开官方 Usage'));
    body.append(actions, renderDiagnostics());
    shell.append(body);
    return shell;
  }

  function render() {
    if (!runtime.app || !runtime.host) return;
    runtime.app.replaceChildren();
    runtime.host.setAttribute('data-wt-mode', runtime.prefs.collapsed ? 'collapsed' : 'expanded');
    runtime.app.append(runtime.prefs.collapsed ? renderCollapsedLauncher() : renderExpandedPanel());
    applyPosition();
  }

  function viewportPosition(position) {
    const width = runtime.host ? runtime.host.getBoundingClientRect().width || runtime.host.offsetWidth : 400;
    const height = runtime.host ? runtime.host.getBoundingClientRect().height || runtime.host.offsetHeight : 200;
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const maxTop = Math.max(12, window.innerHeight - height - 12);
    return { left: Math.max(12, Math.min(maxLeft, numberOrNull(position.left) ?? 12)), top: Math.max(12, Math.min(maxTop, numberOrNull(position.top) ?? 12)) };
  }

  function applyPosition() {
    if (!runtime.host) return;
    if (runtime.prefs.position) {
      const position = viewportPosition(runtime.prefs.position);
      runtime.prefs.position = position;
      runtime.host.style.left = `${position.left}px`;
      runtime.host.style.top = `${position.top}px`;
      runtime.host.style.right = 'auto';
      runtime.host.style.bottom = 'auto';
    } else {
      runtime.host.style.left = 'auto'; runtime.host.style.top = 'auto'; runtime.host.style.right = '20px'; runtime.host.style.bottom = '96px';
    }
  }

  function startDrag(event, dragSurface = event.currentTarget) {
    if (event.button !== undefined && event.button !== 0) return;
    if (!runtime.host) return;
    const surface = dragSurface;
    const isLauncher = surface.classList.contains('wt-launcher');
    if (!isLauncher && event.target.closest && event.target.closest('button, a, select, input, summary')) return;
    const rect = runtime.host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    let moved = false;
    let ended = false;
    surface.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      if (ended) return;
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!moved && distance < 5) return;
      if (!moved) {
        moved = true;
        moveEvent.preventDefault();
      }
      const position = viewportPosition({ left: moveEvent.clientX - offsetX, top: moveEvent.clientY - offsetY });
      runtime.prefs.position = position;
      applyPosition();
    };
    const end = () => {
      if (ended) return;
      ended = true;
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', end);
      surface.removeEventListener('pointercancel', end);
      surface.releasePointerCapture?.(event.pointerId);
      if (moved) {
        writePreference(PREF_KEYS.position, runtime.prefs.position);
        runtime.dragSuppressUntil = Date.now() + 250;
      } else if (isLauncher) {
        runtime.prefs.collapsed = false;
        writePreference(PREF_KEYS.collapsed, false);
        render();
      }
    };
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', end, { once: true });
    surface.addEventListener('pointercancel', end, { once: true });
  }

  function handleAction(event) {
    const actionTarget = event.target.closest && event.target.closest('[data-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === 'toggle') {
      if (runtime.dragSuppressUntil && Date.now() < runtime.dragSuppressUntil) return;
      runtime.prefs.collapsed = !runtime.prefs.collapsed; writePreference(PREF_KEYS.collapsed, runtime.prefs.collapsed); render();
    } else if (action === 'refresh') {
      refresh();
    } else if (action === 'copy-diagnostics') {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        actionTarget.textContent = '复制不可用';
        return;
      }
      navigator.clipboard.writeText(diagnosticText()).then(() => { actionTarget.textContent = '已复制安全诊断'; setTimeout(() => { actionTarget.textContent = '复制诊断信息'; }, 1500); }).catch(() => { actionTarget.textContent = '复制失败'; });
    }
  }

  function scheduleRefresh() {
    clearTimeout(runtime.refreshTimer);
    if (!runtime.prefs.refresh) {
      runtime.refreshTimer = null;
      return;
    }
    const backoff = runtime.state.diagnostics.usageStatus === 429 || runtime.state.diagnostics.analyticsStatus === 429 ? 600_000 : 0;
    runtime.refreshTimer = setTimeout(() => refresh(), Math.max(runtime.prefs.refresh, backoff));
  }

  function createStyle() {
    const style = document.createElement('style');
    style.textContent = `
      :host { --wt-bg: #ffffff; --wt-panel: #f7f7f8; --wt-text: #202123; --wt-muted: #6b7280; --wt-border: #d9d9e0; --wt-accent: #10a37f; --wt-danger: #c2410c; --wt-warning: #b45309; --wt-shadow: 0 16px 50px rgba(0,0,0,.22); color: var(--wt-text); display: block; font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; position: fixed; width: min(400px, calc(100vw - 24px)); z-index: 100000; }
      :host([data-wt-mode="collapsed"]) { height: 48px; width: 48px; }
      :host([data-wt-mode="expanded"]) { max-width: calc(100vw - 24px); }
      @media (prefers-color-scheme: dark) { :host { --wt-bg: #202123; --wt-panel: #2b2c2f; --wt-text: #f7f7f8; --wt-muted: #b5b5bd; --wt-border: #4a4b52; --wt-shadow: 0 16px 50px rgba(0,0,0,.55); } }
      .wt-shell { background: var(--wt-bg); border: 1px solid var(--wt-border); border-radius: 16px; box-shadow: var(--wt-shadow); max-width: 100%; overflow: hidden; }
      .wt-header { align-items: center; background: var(--wt-panel); cursor: grab; display: flex; gap: 10px; justify-content: space-between; padding: 11px 12px; user-select: none; }
      .wt-header:active { cursor: grabbing; } .wt-title-group { min-width: 0; } .wt-title { display: block; font-size: 14px; } .wt-title-status { color: var(--wt-muted); display: block; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button, select, a { font: inherit; } button, a, select { -webkit-tap-highlight-color: transparent; } button:focus-visible, a:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 2px; }
      .wt-icon-button, .wt-button, .wt-link, .wt-select { border: 1px solid var(--wt-border); border-radius: 8px; cursor: pointer; padding: 6px 9px; text-decoration: none; } .wt-icon-button { align-items: center; background: transparent; color: var(--wt-text); display: inline-flex; justify-content: center; } .wt-icon-button svg { height: 18px; width: 18px; } .wt-button { background: var(--wt-accent); border-color: var(--wt-accent); color: #fff; } .wt-button-secondary, .wt-select { background: var(--wt-panel); color: var(--wt-text); } .wt-link { background: transparent; color: var(--wt-accent); display: inline-block; margin: 4px 0; }
      .wt-launcher { align-items: center; background: var(--wt-bg); border: 1px solid var(--wt-border); border-radius: 14px; box-shadow: 0 5px 18px rgba(0,0,0,.16); color: var(--wt-accent); cursor: grab; display: inline-flex; height: 48px; justify-content: center; padding: 0; position: relative; touch-action: none; user-select: none; width: 48px; } .wt-launcher:active { cursor: grabbing; } .wt-launcher svg { height: 24px; width: 24px; } .wt-status-dot { border: 2px solid var(--wt-bg); border-radius: 50%; bottom: 4px; height: 8px; position: absolute; right: 4px; width: 8px; } .wt-status-dot-ok { background: var(--wt-accent); } .wt-status-dot-warning { background: var(--wt-warning); } .wt-status-dot-danger { background: var(--wt-danger); }
      .wt-body { max-height: 70vh; overflow: auto; padding: 0 12px 12px; } .wt-section { border-top: 1px solid var(--wt-border); padding: 12px 0 0; } .wt-section-title, .wt-subtitle { font-size: 13px; margin: 0 0 9px; } .wt-subtitle { color: var(--wt-muted); font-size: 12px; }
      .wt-field-grid { display: grid; gap: 7px 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); } .wt-field { display: flex; flex-direction: column; min-width: 0; } .wt-field-label { color: var(--wt-muted); font-size: 11px; } .wt-field-value { overflow-wrap: anywhere; }
      .wt-badge { background: var(--wt-panel); border-radius: 999px; color: var(--wt-muted); display: inline-block; font-size: 10px; padding: 2px 7px; white-space: nowrap; } .wt-badge-ok { color: var(--wt-accent); } .wt-badge-danger { color: var(--wt-danger); }
      .wt-window { background: var(--wt-panel); border: 1px solid var(--wt-border); border-radius: 10px; margin: 8px 0; padding: 9px; } .wt-window-heading, .wt-subsection-heading, .wt-action-row { align-items: center; display: flex; gap: 8px; justify-content: space-between; } .wt-window-meta, .wt-empty, .wt-notice, .wt-loading { color: var(--wt-muted); font-size: 12px; margin: 5px 0; } .wt-progress-wrap { margin: 8px 0; } .wt-progress { background: var(--wt-border); border-radius: 999px; height: 6px; overflow: hidden; position: relative; } .wt-progress::after { background: var(--wt-accent); border-radius: inherit; content: ''; display: block; height: 100%; width: var(--wt-progress, 0%); } .wt-window-percent-unknown { color: var(--wt-warning); }
      .wt-notice { border: 1px solid var(--wt-border); border-radius: 8px; padding: 8px; } .wt-notice-warning { color: #b45309; } .wt-notice-danger { color: var(--wt-danger); } .wt-subsection { border-top: 1px solid var(--wt-border); margin-top: 12px; padding-top: 10px; } .wt-client-row { border-bottom: 1px solid var(--wt-border); padding: 7px 0; } .wt-client-name, .wt-client-value { display: block; } .wt-client-value { color: var(--wt-muted); font-size: 11px; }
      .wt-chart { align-items: end; display: flex; gap: 3px; height: 130px; overflow-x: auto; padding-top: 8px; } .wt-chart-column { align-items: center; display: flex; flex: 1 0 14px; flex-direction: column; height: 100%; justify-content: end; min-width: 14px; } .wt-chart-bar { background: var(--wt-accent); border-radius: 3px 3px 0 0; min-height: 3px; width: 100%; } .wt-chart-label { color: var(--wt-muted); font-size: 9px; margin-top: 3px; transform: rotate(-45deg); transform-origin: top center; white-space: nowrap; }
      .wt-action-row { justify-content: flex-start; margin-bottom: 5px; } .wt-diagnostics { border-top: 1px solid var(--wt-border); margin-top: 12px; padding-top: 10px; } .wt-diagnostics summary { cursor: pointer; font-weight: 600; margin-bottom: 8px; } .wt-diagnostics .wt-field { margin: 6px 0; } .wt-loading { min-height: 120px; padding-top: 18px; } .wt-chart-select { margin-left: auto; } @media (max-width: 480px) { :host([data-wt-mode="expanded"]) { width: calc(100vw - 24px); } .wt-body { max-height: 68vh; } }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
    `;
    return style;
  }

  function mount() {
    if (runtime.host && runtime.host.isConnected) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-label', 'ChatGPT 账户用量浮窗');
    const shadow = host.attachShadow({ mode: 'open' });
    const app = el('div', 'wt-app');
    shadow.append(createStyle(), app);
    document.documentElement.append(host);
    runtime.host = host; runtime.shadow = shadow; runtime.app = app;
    app.addEventListener('click', handleAction);
    app.addEventListener('pointerdown', (event) => {
      const surface = event.target.closest?.('.wt-drag-handle');
      if (surface) startDrag(event, surface);
    });
    applyPosition();
    render();
    if (!runtime.state.data && !runtime.refreshPromise) refresh();
  }

  function onRouteChange() {
    setTimeout(() => { mount(); if (!runtime.state.data && !runtime.refreshPromise) refresh(); }, 0);
  }

  function setupLifecycle() {
    if (runtime.lifecycleReady) return;
    runtime.lifecycleReady = true;
    runtime.originalPushState = history.pushState;
    runtime.originalReplaceState = history.replaceState;
    history.pushState = function (...args) { const result = runtime.originalPushState.apply(this, args); window.dispatchEvent(new Event('wt-chatgpt-route-change')); return result; };
    history.replaceState = function (...args) { const result = runtime.originalReplaceState.apply(this, args); window.dispatchEvent(new Event('wt-chatgpt-route-change')); return result; };
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('wt-chatgpt-route-change', onRouteChange);
    runtime.visibilityHandler = () => { if (document.visibilityState === 'visible' && runtime.state.fetchedAt && Date.now() - runtime.state.fetchedAt > 120_000) refresh(); };
    document.addEventListener('visibilitychange', runtime.visibilityHandler);
    window.addEventListener('resize', applyPosition, { passive: true });
    const themeObserver = new MutationObserver(() => render());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'color-scheme'] });
    if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'color-scheme'] });
    runtime.observers.push(themeObserver);
    const attachBodyObserver = () => {
      runtime.bodyObserver?.disconnect();
      runtime.bodyObserver = null;
      if (!document.body) return;
      runtime.bodyObserver = new MutationObserver(() => { if (!runtime.host || !runtime.host.isConnected) mount(); });
      runtime.bodyObserver._wtObservedBody = document.body;
      runtime.bodyObserver.observe(document.body, { childList: true, subtree: true });
    };
    attachBodyObserver();
    const documentObserver = new MutationObserver(() => {
      if (!runtime.host || !runtime.host.isConnected) mount();
      if (document.body && runtime.bodyObserver && runtime.bodyObserver._wtObservedBody !== document.body) attachBodyObserver();
    });
    documentObserver.observe(document.documentElement, { childList: true });
    runtime.observers.push(documentObserver);
  }

  function cleanup() {
    clearTimeout(runtime.refreshTimer);
    runtime.abortController?.abort();
    runtime.observers.forEach((observer) => observer.disconnect());
    runtime.bodyObserver?.disconnect();
    runtime.bodyObserver = null;
    runtime.observers = [];
    if (runtime.originalPushState) history.pushState = runtime.originalPushState;
    if (runtime.originalReplaceState) history.replaceState = runtime.originalReplaceState;
    window.removeEventListener('popstate', onRouteChange);
    window.removeEventListener('wt-chatgpt-route-change', onRouteChange);
    document.removeEventListener('visibilitychange', runtime.visibilityHandler);
    window.removeEventListener('resize', applyPosition);
    runtime.visibilityHandler = null;
    runtime.lifecycleReady = false;
    runtime.originalPushState = null;
    runtime.originalReplaceState = null;
    runtime.host?.remove();
    runtime.host = null; runtime.app = null; runtime.shadow = null;
    runtime.accountFingerprint = null;
  }

  function initialize() {
    setupLifecycle();
    mount();
  }

  window.wtChatgptAccountUsageCleanup = cleanup;
  initialize();
})();
