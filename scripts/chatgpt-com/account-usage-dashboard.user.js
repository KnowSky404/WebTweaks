// ==UserScript==
// @name         ChatGPT Account Usage Dashboard
// @name:zh-CN   ChatGPT 账户用量浮窗
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.0.0
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

  const VERSION = '1.0.0';
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

  function durationSeconds(source) {
    const seconds = numberOrNull(firstDefined(source, ['limit_window_seconds', 'limitWindowSeconds', 'duration_seconds', 'durationSeconds', 'window_seconds', 'windowSeconds']));
    if (seconds !== null) return seconds;
    const minutes = numberOrNull(firstDefined(source, ['window_minutes', 'windowMinutes', 'duration_minutes', 'durationMinutes']));
    return minutes === null ? null : minutes * 60;
  }

  function windowLabel(source, scope, index) {
    const duration = durationSeconds(source);
    const explicit = firstDefined(source, ['label', 'name', 'title', 'feature']);
    if (explicit) return String(explicit);
    if (duration !== null && duration >= 4 * 3600 && duration <= 6 * 3600) return '约 5 小时窗口';
    if (duration !== null && duration >= 6 * 86400 && duration <= 8 * 86400) return '约 7 天窗口';
    if (duration !== null && duration >= 86400) return `${Math.round(duration / 86400)} 天窗口`;
    if (duration !== null) return `${Math.round(duration / 3600)} 小时窗口`;
    return `${scope === 'additional' ? '额外额度' : '额度窗口'} ${index + 1}`;
  }

  function normalizeWindow(source, scope, index, sourcePath) {
    if (!isRecord(source)) return null;
    let used = clampPercent(firstDefined(source, ['used_percent', 'usedPercent', 'usage_percent', 'usagePercent']));
    let remaining = clampPercent(firstDefined(source, ['remaining_percent', 'remainingPercent']));
    if (used === null && remaining !== null) used = 100 - remaining;
    if (remaining === null && used !== null) remaining = 100 - used;
    const duration = durationSeconds(source);
    const resetAt = parseTimestamp(firstDefined(source, ['reset_at', 'resetAt', 'reset_time', 'resetTime']));
    const resetAfter = numberOrNull(firstDefined(source, ['reset_after_seconds', 'resetAfterSeconds']));
    return {
      id: `${scope}-${index}-${sourcePath}`,
      scope,
      feature: firstDefined(source, ['feature', 'feature_name', 'featureName']),
      label: windowLabel(source, scope, index),
      durationSeconds: duration,
      usedPercent: used,
      remainingPercent: remaining,
      resetAt,
      resetAfterSeconds: resetAfter,
      limitReached: boolOrNull(firstDefined(source, ['limit_reached', 'limitReached'])),
      allowed: boolOrNull(firstDefined(source, ['allowed', 'is_allowed', 'isAllowed'])),
      sourcePath
    };
  }

  function looksLikeWindow(value) {
    return isRecord(value) && [
      'used_percent', 'usedPercent', 'remaining_percent', 'remainingPercent', 'limit_window_seconds', 'limitWindowSeconds',
      'window_minutes', 'windowMinutes', 'reset_at', 'resetAt', 'reset_after_seconds', 'resetAfterSeconds', 'allowed', 'limit_reached'
    ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  function collectWindows(usage) {
    const windows = [];
    const primary = firstDefined(usage, ['primary_window', 'primaryWindow']);
    const secondary = firstDefined(usage, ['secondary_window', 'secondaryWindow']);
    if (primary) windows.push(normalizeWindow(primary, 'primary', 0, 'primary_window'));
    if (secondary) windows.push(normalizeWindow(secondary, 'primary', 1, 'secondary_window'));
    const rates = firstDefined(usage, ['rate_limits', 'rateLimits', 'rate_limit', 'rateLimit']);
    if (Array.isArray(rates)) rates.forEach((item, index) => windows.push(normalizeWindow(item, 'primary', index, 'rate_limits')));
    else if (looksLikeWindow(rates)) windows.push(normalizeWindow(rates, 'primary', 0, 'rate_limit'));
    else if (isRecord(rates)) {
      for (const [key, value] of Object.entries(rates)) {
        if (isRecord(value)) windows.push(normalizeWindow(value, 'primary', windows.length, `rate_limits.${key}`));
      }
    }
    const additional = firstDefined(usage, ['additional_rate_limits', 'additionalRateLimits']);
    if (Array.isArray(additional)) additional.forEach((item, index) => windows.push(normalizeWindow(item, 'additional', index, 'additional_rate_limits')));
    else if (looksLikeWindow(additional)) windows.push(normalizeWindow(additional, 'additional', 0, 'additional_rate_limits'));
    else if (isRecord(additional)) {
      for (const [key, value] of Object.entries(additional)) {
        if (isRecord(value)) windows.push(normalizeWindow(value, 'additional', indexSafe(windows), `additional_rate_limits.${key}`));
      }
    }
    return windows.filter(Boolean).filter((item, index, all) => all.findIndex((candidate) => candidate.sourcePath === item.sourcePath && candidate.resetAt === item.resetAt && candidate.durationSeconds === item.durationSeconds) === index);
  }

  function indexSafe(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function normalizeUsage(payload, session, fetchedAt) {
    const usage = unwrapData(payload);
    if (!isRecord(usage)) throw new Error('schema');
    const identity = getSessionIdentity(session);
    const windows = collectWindows(usage);
    const rawType = firstDefined(usage, ['plan_type', 'planType']);
    const credits = unwrapData(firstDefined(usage, ['credits', 'credit_status', 'creditStatus'])) || {};
    const resetCredits = unwrapData(firstDefined(usage, ['rate_limit_reset_credits', 'rateLimitResetCredits'])) || {};
    const spend = unwrapData(firstDefined(usage, ['spend_control', 'spendControl'])) || {};
    const allowed = boolOrNull(firstDefined(usage, ['allowed', 'is_allowed', 'isAllowed']));
    const limitReached = boolOrNull(firstDefined(usage, ['limit_reached', 'limitReached']));
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
    } else {
      bar.classList.add('wt-progress-unknown');
    }
    wrapper.append(bar);
    return wrapper;
  }

  function renderWindow(window) {
    const card = el('article', 'wt-window');
    const heading = el('div', 'wt-window-heading');
    heading.append(el('strong', 'wt-window-label', window.label), statusBadge(window.limitReached === true ? '已达到限制' : window.allowed === false ? '不可用' : '可用', window.limitReached === true ? 'danger' : 'ok'));
    card.append(heading, el('div', 'wt-window-meta', `${window.scope === 'additional' ? '额外额度' : '主额度'} · 周期 ${formatDuration(window.durationSeconds)}`));
    card.append(createProgress(window.usedPercent, `${window.label} 已使用百分比`));
    const grid = el('div', 'wt-field-grid');
    grid.append(field('已使用', formatPercent(window.usedPercent)), field('剩余', formatPercent(window.remainingPercent)), field('重置时间', formatDate(window.resetAt)), field('倒计时', formatCountdown(window.resetAt)));
    card.append(grid);
    return card;
  }

  function renderAccount(data) {
    const node = section('当前账户');
    node.append(field('登录状态', data.session.signedIn === null ? '未提供' : data.session.signedIn ? '已登录' : '未登录'), field('显示名', data.session.displayName));
    if (runtime.prefs.email) node.append(field('邮箱（脱敏）', data.session.maskedEmail));
    node.append(field('套餐', data.plan.label), field('原始 plan_type', data.plan.rawType), field('用量允许', data.plan.allowed === null ? '未提供' : data.plan.allowed ? '是' : '否'), field('达到限制', data.plan.limitReached === null ? '未提供' : data.plan.limitReached ? '是' : '否'), field('最后更新时间', formatDate(data.fetchedAt)));
    return node;
  }

  function renderCredits(data) {
    const node = section('Credits 和账户用量状态');
    const grid = el('div', 'wt-field-grid');
    grid.append(field('has_credits', data.credits.hasCredits === null ? '未提供' : data.credits.hasCredits ? '是' : '否'), field('unlimited', data.credits.unlimited === null ? '未提供' : data.credits.unlimited ? '是' : '否'), field('balance', formatNumber(data.credits.balance)), field('可用重置券', formatNumber(data.credits.resetCreditsAvailable)), field('spend_control', data.spendControl.reached === null ? '未提供' : data.spendControl.reached ? '已达到' : '未达到'), field('spend 已用', formatNumber(data.spendControl.used)), field('spend 限额', formatNumber(data.spendControl.limit)), field('spend 已用百分比', formatPercent(data.spendControl.usedPercent)), field('spend 剩余百分比', formatPercent(data.spendControl.remainingPercent)), field('spend 重置时间', formatDate(data.spendControl.resetAt)), field('allowed', data.plan.allowed === null ? '未提供' : data.plan.allowed ? '是' : '否'), field('limit_reached', data.plan.limitReached === null ? '未提供' : data.plan.limitReached ? '是' : '否'));
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
      ['额度窗口数量', runtime.state.data ? runtime.state.data.windows.length : 0], ['每日数据行数', runtime.state.diagnostics.dailyRows],
      ['客户端类型', runtime.state.diagnostics.clientTypes.join(', ') || '未提供'], ['未识别顶层字段', runtime.state.diagnostics.unknownFields.join(', ') || '无'], ['错误代码', runtime.state.diagnostics.errors.join(', ') || '无']
    ];
    for (const [label, value] of lines) details.append(field(label, value));
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
      `额度窗口数量: ${runtime.state.data ? runtime.state.data.windows.length : 0}`, `每日数据行数: ${runtime.state.diagnostics.dailyRows}`,
      `客户端类型: ${runtime.state.diagnostics.clientTypes.join(', ') || '未提供'}`, `未识别顶层字段: ${runtime.state.diagnostics.unknownFields.join(', ') || '无'}`, `错误代码: ${runtime.state.diagnostics.errors.join(', ') || '无'}`
    ];
    return lines.join('\n');
  }

  function render() {
    if (!runtime.app) return;
    runtime.app.replaceChildren();
    const shell = el('div', `wt-shell ${runtime.prefs.collapsed ? 'wt-shell-collapsed' : ''}`.trim());
    const header = el('div', 'wt-header wt-drag-handle');
    const title = el('div', 'wt-title-group');
    title.append(el('strong', 'wt-title', '账户用量'), el('span', 'wt-title-status', runtime.state.stale ? '数据可能已过期' : runtime.state.loading ? '读取中…' : runtime.state.error ? runtime.state.error : '就绪'));
    const toggle = setAttributes(el('button', 'wt-icon-button', runtime.prefs.collapsed ? '展开' : '收起'), { type: 'button', 'aria-label': runtime.prefs.collapsed ? '展开账户用量面板' : '收起账户用量面板', 'aria-expanded': String(!runtime.prefs.collapsed) });
    toggle.dataset.action = 'toggle';
    header.append(title, toggle);
    shell.append(header);
    if (runtime.prefs.collapsed) {
      const compact = el('button', 'wt-compact wt-drag-handle');
      compact.type = 'button';
      compact.dataset.action = 'toggle';
      const data = runtime.state.data;
      compact.append(el('strong', 'wt-compact-plan', data ? data.plan.label : runtime.state.loading ? '读取中…' : 'ChatGPT 用量'), statusBadge(data && data.windows[0] ? formatPercent(data.windows[0].usedPercent) : '未提供', data && data.windows[0] && data.windows[0].limitReached ? 'danger' : ''), el('span', 'wt-compact-reset', data && data.windows[0] ? formatCountdown(data.windows[0].resetAt) : (runtime.state.error || '点击查看')));
      shell.append(compact);
    } else {
      const body = el('div', 'wt-body');
      if (runtime.state.loading && !runtime.state.data) body.append(el('div', 'wt-loading', '正在读取账户与额度…'));
      if (runtime.state.error && !runtime.state.data) body.append(el('div', 'wt-notice wt-notice-danger', runtime.state.error));
      if (runtime.state.data) {
        body.append(renderAccount(runtime.state.data), renderCredits(runtime.state.data));
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
    }
    runtime.app.append(shell);
    applyPosition();
  }

  function viewportPosition(position) {
    const width = runtime.host ? runtime.host.offsetWidth : 400;
    const height = runtime.host ? runtime.host.offsetHeight : 200;
    return { left: Math.max(12, Math.min(window.innerWidth - width - 12, numberOrNull(position.left) || 12)), top: Math.max(12, Math.min(window.innerHeight - height - 12, numberOrNull(position.top) || 12)) };
  }

  function applyPosition() {
    if (!runtime.host) return;
    if (runtime.prefs.position) {
      const position = viewportPosition(runtime.prefs.position);
      runtime.host.style.left = `${position.left}px`;
      runtime.host.style.top = `${position.top}px`;
      runtime.host.style.right = 'auto';
      runtime.host.style.bottom = 'auto';
    } else {
      runtime.host.style.left = 'auto'; runtime.host.style.top = 'auto'; runtime.host.style.right = '20px'; runtime.host.style.bottom = '96px';
    }
  }

  function startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest && event.target.closest('button, a, select, input, summary')) return;
    if (!runtime.host) return;
    event.preventDefault();
    const rect = runtime.host.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const surface = event.currentTarget;
    surface.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const position = viewportPosition({ left: moveEvent.clientX - offsetX, top: moveEvent.clientY - offsetY });
      runtime.prefs.position = position;
      applyPosition();
    };
    const end = () => {
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', end);
      surface.removeEventListener('pointercancel', end);
      writePreference(PREF_KEYS.position, runtime.prefs.position);
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
      :host { --wt-bg: #ffffff; --wt-panel: #f7f7f8; --wt-text: #202123; --wt-muted: #6b7280; --wt-border: #d9d9e0; --wt-accent: #10a37f; --wt-danger: #c2410c; --wt-shadow: 0 16px 50px rgba(0,0,0,.22); color: var(--wt-text); display: block; font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; position: fixed; width: min(420px, calc(100vw - 24px)); z-index: 100000; }
      @media (prefers-color-scheme: dark) { :host { --wt-bg: #202123; --wt-panel: #2b2c2f; --wt-text: #f7f7f8; --wt-muted: #b5b5bd; --wt-border: #4a4b52; --wt-shadow: 0 16px 50px rgba(0,0,0,.55); } }
      .wt-shell { background: var(--wt-bg); border: 1px solid var(--wt-border); border-radius: 16px; box-shadow: var(--wt-shadow); overflow: hidden; }
      .wt-header { align-items: center; background: var(--wt-panel); cursor: grab; display: flex; gap: 10px; justify-content: space-between; padding: 11px 12px; user-select: none; }
      .wt-header:active { cursor: grabbing; } .wt-title-group { min-width: 0; } .wt-title { display: block; font-size: 14px; } .wt-title-status { color: var(--wt-muted); display: block; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button, select, a { font: inherit; } button, a, select { -webkit-tap-highlight-color: transparent; } button:focus-visible, a:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 2px; }
      .wt-icon-button, .wt-button, .wt-link, .wt-select { border: 1px solid var(--wt-border); border-radius: 8px; cursor: pointer; padding: 6px 9px; text-decoration: none; } .wt-icon-button { background: transparent; color: var(--wt-text); } .wt-button { background: var(--wt-accent); border-color: var(--wt-accent); color: #fff; } .wt-button-secondary, .wt-select { background: var(--wt-panel); color: var(--wt-text); } .wt-link { background: transparent; color: var(--wt-accent); display: inline-block; margin: 4px 0; }
      .wt-compact { align-items: center; background: var(--wt-bg); border: 0; color: var(--wt-text); cursor: pointer; display: grid; gap: 3px; grid-template-columns: 1fr auto; padding: 10px 12px; text-align: left; width: 100%; } .wt-compact-reset { color: var(--wt-muted); font-size: 11px; grid-column: 1 / -1; } .wt-compact-plan { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wt-body { max-height: 70vh; overflow: auto; padding: 0 12px 12px; } .wt-section { border-top: 1px solid var(--wt-border); padding: 12px 0 0; } .wt-section-title, .wt-subtitle { font-size: 13px; margin: 0 0 9px; } .wt-subtitle { color: var(--wt-muted); font-size: 12px; }
      .wt-field-grid { display: grid; gap: 7px 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); } .wt-field { display: flex; flex-direction: column; min-width: 0; } .wt-field-label { color: var(--wt-muted); font-size: 11px; } .wt-field-value { overflow-wrap: anywhere; }
      .wt-badge { background: var(--wt-panel); border-radius: 999px; color: var(--wt-muted); display: inline-block; font-size: 10px; padding: 2px 7px; white-space: nowrap; } .wt-badge-ok { color: var(--wt-accent); } .wt-badge-danger { color: var(--wt-danger); }
      .wt-window { background: var(--wt-panel); border: 1px solid var(--wt-border); border-radius: 10px; margin: 8px 0; padding: 9px; } .wt-window-heading, .wt-subsection-heading, .wt-action-row { align-items: center; display: flex; gap: 8px; justify-content: space-between; } .wt-window-meta, .wt-empty, .wt-notice, .wt-loading { color: var(--wt-muted); font-size: 12px; margin: 5px 0; } .wt-progress-wrap { margin: 8px 0; } .wt-progress { background: var(--wt-border); border-radius: 999px; height: 6px; overflow: hidden; position: relative; } .wt-progress::after { background: var(--wt-accent); border-radius: inherit; content: ''; display: block; height: 100%; width: var(--wt-progress, 0%); } .wt-progress-unknown::after { background: var(--wt-muted); width: 35%; }
      .wt-notice { border: 1px solid var(--wt-border); border-radius: 8px; padding: 8px; } .wt-notice-warning { color: #b45309; } .wt-notice-danger { color: var(--wt-danger); } .wt-subsection { border-top: 1px solid var(--wt-border); margin-top: 12px; padding-top: 10px; } .wt-client-row { border-bottom: 1px solid var(--wt-border); padding: 7px 0; } .wt-client-name, .wt-client-value { display: block; } .wt-client-value { color: var(--wt-muted); font-size: 11px; }
      .wt-chart { align-items: end; display: flex; gap: 3px; height: 130px; overflow-x: auto; padding-top: 8px; } .wt-chart-column { align-items: center; display: flex; flex: 1 0 14px; flex-direction: column; height: 100%; justify-content: end; min-width: 14px; } .wt-chart-bar { background: var(--wt-accent); border-radius: 3px 3px 0 0; min-height: 3px; width: 100%; } .wt-chart-label { color: var(--wt-muted); font-size: 9px; margin-top: 3px; transform: rotate(-45deg); transform-origin: top center; white-space: nowrap; }
      .wt-action-row { justify-content: flex-start; margin-bottom: 5px; } .wt-diagnostics { border-top: 1px solid var(--wt-border); margin-top: 12px; padding-top: 10px; } .wt-diagnostics summary { cursor: pointer; font-weight: 600; margin-bottom: 8px; } .wt-diagnostics .wt-field { margin: 6px 0; } .wt-loading { min-height: 120px; padding-top: 18px; } .wt-chart-select { margin-left: auto; } @media (max-width: 480px) { :host { width: calc(100vw - 24px); } .wt-body { max-height: 68vh; } }
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
    app.addEventListener('pointerdown', (event) => { if (event.target.closest?.('.wt-drag-handle')) startDrag(event); });
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
