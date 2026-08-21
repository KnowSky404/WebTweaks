// ==UserScript==
// @name         ChatGPT Account Usage Dashboard
// @name:zh-CN   ChatGPT 账户用量浮窗
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.5.0
// @description  Display the current ChatGPT account plan, Codex limits, and reliable usage analytics in a private floating dashboard.
// @description:zh-CN 在 ChatGPT 页面显示当前账号套餐、Codex 额度与可靠的使用统计。
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

  const VERSION = '1.5.0';
  const HOST_ID = 'wt-chatgpt-account-usage-host';
  const SESSION_ENDPOINT = '/api/auth/session';
  const USAGE_ENDPOINT = '/backend-api/wham/usage';
  const ANALYTICS_ENDPOINT = '/backend-api/wham/analytics/daily-workspace-usage-counts';
  const MODEL_BREAKDOWN_ENDPOINT = '/backend-api/wham/usage/daily-token-usage-breakdown';
  const THREAD_USAGE_ENDPOINT = '/backend-api/wham/usage/thread_usage/query';
  const ANALYTICS_URL = 'https://chatgpt.com/codex/cloud/settings/analytics';
  const REQUEST_TIMEOUT_MS = 8000;
  const THREAD_USAGE_TIMEOUT_MS = 10_000;
  const AUTO_REFRESH_INTERVAL_MS = 300_000;
  const LEGACY_REFRESH_PREF_KEY = 'wt-chatgpt-account-usage:refresh-interval';
  const POSITION_VERSION = 2;
  const VIEWPORT_MARGIN_PX = 12;
  const DEFAULT_POSITION_ANCHOR = Object.freeze({
    version: POSITION_VERSION,
    horizontal: 'right',
    vertical: 'bottom',
    offsetX: 20,
    offsetY: 96
  });
  const MAX_CUSTOM_RANGE_DAYS = 366;
  const CREDIT_USD_RATE = 0.04;
  const METRIC_KEYS = Object.freeze(['credits', 'tokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'threads', 'turns']);
  // Keep unsupported rate cards explicit; missing prices must never become a guessed UI amount.
  const MODEL_PRICING = Object.freeze({
    'gpt-5.6-sol': Object.freeze({ inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30, effectiveDate: '2026-08-21' }),
    'gpt-5.6-terra': Object.freeze({ inputPerMillion: null, cachedInputPerMillion: null, outputPerMillion: null, effectiveDate: null }),
    'gpt-5.6-luna': Object.freeze({ inputPerMillion: null, cachedInputPerMillion: null, outputPerMillion: null, effectiveDate: null }),
    'gpt-5.5': Object.freeze({ inputPerMillion: null, cachedInputPerMillion: null, outputPerMillion: null, effectiveDate: null })
  });
  const threadUsageProvider = Object.freeze({
    source: 'thread_api',
    confidence: 'authoritative',
    endpoint: THREAD_USAGE_ENDPOINT,
    diagnosticOnly: false,
    costAvailable: true,
    createState: createThreadUsageProviderState,
    inspect: inspectThreadUsageResponse,
    resolveCost: resolveThreadUsageCost,
    probe: probeThreadUsage
  });
  const creditProvider = Object.freeze({
    source: 'codex-credit',
    confidence: 'high',
    endpoint: ANALYTICS_ENDPOINT,
    readCredits: readDailyCredits,
    resolveCost: resolveCreditCost
  });
  const tokenPricingProvider = Object.freeze({
    source: 'token-pricing',
    confidence: 'estimated',
    estimate: estimateApiCost,
    resolve: resolveTokenPricingCost
  });
  const usageCostProviders = Object.freeze({
    threadUsageProvider,
    creditProvider,
    tokenPricingProvider
  });
  // OpenAI Codex exposes ProLite and Pro plan types; this product surface names them Pro 5X and Pro 20X.
  // These are tier names, not a quota calculator. The server window remains authoritative.
  const PLAN_DISPLAY = Object.freeze({
    free: { label: 'Free', hint: '有限 Codex 使用' },
    go: { label: 'Go', hint: '扩展基础使用' },
    plus: { label: 'Plus', hint: '扩展 Codex 用量' },
    prolite: { label: 'Pro Lite（Pro 5X）', hint: 'Pro 5X 套餐档位' },
    pro: { label: 'Pro（Pro 20X）', hint: 'Pro 20X 套餐档位' },
    business: { label: 'Business', hint: 'Business 工作区档位' },
    team: { label: 'Business', hint: 'Business 工作区档位' },
    enterprise: { label: 'Enterprise', hint: 'Enterprise 工作区档位' },
    enterprise_cbp: { label: 'Enterprise', hint: 'Enterprise 工作区档位' },
    enterprise_cbp_usage_based: { label: 'Enterprise', hint: 'Enterprise 工作区档位' },
    edu: { label: 'Edu', hint: 'Edu 教育档位' }
  });
  const RANGE_PRESETS = Object.freeze([
    { id: 'cycle', label: '当前周期' },
    { id: 'month', label: '本月' },
    { id: '7d', label: '近 7 天' },
    { id: '30d', label: '近 30 天' },
    { id: 'custom', label: '自定义' }
  ]);
  const RANGE_OPTIONS = RANGE_PRESETS.map((range) => range.id);
  const PREF_KEYS = {
    position: 'wt-chatgpt-account-usage:position',
    collapsed: 'wt-chatgpt-account-usage:collapsed',
    sections: 'wt-chatgpt-account-usage:sections',
    range: 'wt-chatgpt-account-usage:range',
    email: 'wt-chatgpt-account-usage:show-email',
    metric: 'wt-chatgpt-account-usage:chart-metric',
    customStart: 'wt-chatgpt-account-usage:custom-start',
    customEnd: 'wt-chatgpt-account-usage:custom-end'
  };
  const SECTION_IDS = Object.freeze(['account', 'quota', 'stats', 'cycle', 'diagnostics']);
  const DEFAULT_SECTION_COLLAPSED = Object.freeze({
    account: false,
    quota: false,
    stats: false,
    cycle: false,
    diagnostics: true
  });
  const DEFAULT_PREFS = {
    position: null,
    collapsed: true,
    sectionCollapsed: DEFAULT_SECTION_COLLAPSED,
    range: 'cycle',
    email: true,
    metric: 'tokens',
    customStart: null,
    customEnd: null
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
    visibilityHandler: null,
    analyticsPromise: null,
    modelBreakdownPromise: null,
    threadUsageAbortController: null,
    lastUsageHeaders: {},
    ui: {
      panelSession: 0,
      pendingPanelState: null,
      tooltipTimer: null,
      positionFrame: null,
      threadUsageDialogOpen: false,
      threadUsageInput: '',
      threadUsageValidationError: null,
      threadUsageProbeLoading: false
    }
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
      analytics: createAnalyticsState(),
      modelBreakdown: createModelBreakdownState(),
      threadUsageProvider: threadUsageProvider.createState(),
      costEstimate: createCostEstimate({ notes: ['等待 Codex Credits 或其他可验证成本来源'] }),
      diagnostics: {
        usageStatus: null,
        analyticsStatus: null,
        modelBreakdownStatus: null,
        modelRows: 0,
        costProviderSource: 'unknown',
        costConfidence: 'unknown',
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

  function createThreadUsageProviderState() {
    return {
      status: 'unknown',
      checkedAt: null,
      endpointAvailable: false,
      threadUsageSupported: false,
      supportsTokenBreakdown: false,
      supportsUsdEstimate: false,
      supportsCreditEstimate: false,
      httpStatus: null,
      lastError: null,
      authoritativeCost: createCostEstimate()
    };
  }

  function createModelBreakdownState() {
    return {
      units: null,
      rows: [],
      dailyRows: [],
      loading: false,
      error: null,
      stale: false
    };
  }

  function createCostEstimate(overrides = {}) {
    return {
      valueUsd: overrides.valueUsd ?? null,
      source: overrides.source || 'unknown',
      confidence: overrides.confidence || 'unknown',
      coveragePercent: overrides.coveragePercent ?? null,
      notes: Array.isArray(overrides.notes) ? [...overrides.notes] : []
    };
  }

  function createAnalyticsState() {
    return {
      dailyRows: [],
      clientRows: [],
      ranges: {},
      coverage: { start: null, end: null, segments: [] },
      loading: false,
      error: null,
      lastRequest: null,
      cacheHit: false,
      selectedBucketCount: 0,
      lastGoodRange: '30d'
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

  function getQuotaProgressColor(percent, theme = runtime.host?.getAttribute('data-wt-theme') || 'light') {
    const value = clampPercent(percent);
    if (value === null) return 'transparent';
    const stops = theme === 'dark'
      ? [[0, [72, 201, 116]], [30, [112, 167, 255]], [60, [82, 132, 242]], [90, [241, 173, 66]], [100, [255, 123, 114]]]
      : [[0, [21, 148, 71]], [30, [37, 99, 235]], [60, [29, 78, 216]], [90, [184, 106, 8]], [100, [196, 61, 50]]];
    let left = stops[0];
    let right = stops[stops.length - 1];
    for (let index = 1; index < stops.length; index += 1) {
      if (value <= stops[index][0]) {
        right = stops[index];
        left = stops[index - 1];
        break;
      }
    }
    const span = right[0] - left[0] || 1;
    const ratio = (value - left[0]) / span;
    const channels = left[1].map((channel, index) => Math.round(channel + (right[1][index] - channel) * ratio));
    return `rgb(${channels.join(', ')})`;
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

  function inclusiveRangeToExclusiveRange(startDate, endInclusive) {
    return { start: startDate, end: addDays(endInclusive, 1) };
  }

  function lastNDaysRange(days) {
    const today = todayKeyUTC();
    return { start: addDays(today, -(days - 1)), end: addDays(today, 1) };
  }

  function dateDifferenceInDays(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00Z`).getTime();
    const end = new Date(`${endDate}T00:00:00Z`).getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : null;
  }

  function isValidDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validateCustomRange(startDate, endDate, now = Date.now()) {
    const today = dateKeyUTC(now);
    if (!startDate) return '请选择开始日期';
    if (!endDate) return '请选择结束日期';
    if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) return '请选择有效日期';
    if (startDate > endDate) return '开始日期不能晚于结束日期';
    if (endDate > today) return '结束日期不能晚于今天';
    const days = dateDifferenceInDays(startDate, endDate);
    if (days === null || days < 0) return '日期范围无效';
    if (days + 1 > MAX_CUSTOM_RANGE_DAYS) return `日期范围不能超过 ${MAX_CUSTOM_RANGE_DAYS} 天`;
    return null;
  }

  function sumOptional(values) {
    const numbers = values.map(numberOrNull).filter((value) => value !== null);
    return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
  }

  function mergeMetricValues(left, right) {
    const result = {};
    for (const key of METRIC_KEYS) {
      result[key] = sumOptional([left && left[key], right && right[key]]);
    }
    return result;
  }

  function coalesceMetricValues(primary, fallback) {
    const result = {};
    for (const key of METRIC_KEYS) {
      result[key] = primary?.[key] !== null && primary?.[key] !== undefined
        ? primary[key]
        : fallback?.[key] ?? null;
    }
    return result;
  }

  function normalizeMetrics(value) {
    const source = isRecord(value) ? value : {};
    const metrics = {
      credits: numberOrNull(firstDefined(source, ['credits', 'total_credits', 'totalCredits'])),
      tokens: numberOrNull(firstDefined(source, ['tokens', 'total_tokens', 'totalTokens', 'text_total_tokens', 'textTotalTokens'])),
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

  function readDailyCredits(row) {
    const credits = numberOrNull(firstDefined(row, ['totals.credits']));
    return credits !== null && credits > 0 ? credits : null;
  }

  function resolveCreditCost(value) {
    const credits = typeof value === 'number'
      ? numberOrNull(value)
      : numberOrNull(firstDefined(value, ['credits', 'totals.credits']));
    if (credits === null || credits <= 0) {
      return createCostEstimate({ source: 'credit-unavailable', confidence: 'unknown', notes: ['Credit数据不可用；不会把缺失或零值显示为 $0'] });
    }
    return createCostEstimate({
      valueUsd: credits * CREDIT_USD_RATE,
      source: 'codex-credit',
      confidence: 'high',
      coveragePercent: 100,
      notes: ['1000 Credits ≈ $40；这是 API 等价价值，不代表 ChatGPT 订阅收费金额']
    });
  }

  function formatModelName(value) {
    if (typeof value !== 'string' || !value.trim()) return '未命名模型';
    const parts = value.trim().replace(/_/g, '-').split('-').filter(Boolean);
    if (parts.length >= 2 && parts[0].toLowerCase() === 'gpt') {
      const suffix = parts.slice(2).map((part) => prettyName(part)).join(' ');
      return `GPT-${parts[1]}${suffix ? ` ${suffix}` : ''}`;
    }
    return prettyName(value, '未命名模型');
  }

  function formatModelSpeed(value) {
    if (typeof value !== 'string' || !value.trim()) return '速度未提供';
    return prettyName(value, '速度未提供');
  }

  function formatUsageShare(value) {
    const number = numberOrNull(value);
    if (number === null || number < 0) return '未提供';
    return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number)}%`;
  }

  function normalizeModelRows(modelRows) {
    const merged = new Map();
    for (const modelRow of modelRows) {
      if (!isRecord(modelRow)) continue;
      const model = firstDefined(modelRow, ['model', 'model_name', 'modelName']);
      const speed = firstDefined(modelRow, ['speed', 'mode', 'inference_speed', 'inferenceSpeed']) || 'unknown';
      const value = numberOrNull(firstDefined(modelRow, ['credits', 'sharePercent']));
      if (typeof model !== 'string' || !model.trim() || value === null || value <= 0 || value > 100) continue;
      const key = `${model.trim()}\u0000${String(speed).trim()}`;
      merged.set(key, (merged.get(key) || 0) + value);
    }
    return [...merged.entries()]
      .map(([key, sharePercent]) => {
        const separator = key.indexOf('\u0000');
        return { model: key.slice(0, separator), speed: key.slice(separator + 1), sharePercent: numberOrNull(sharePercent) };
      })
      .filter((row) => row.sharePercent !== null && row.sharePercent > 0)
      .sort((left, right) => right.sharePercent - left.sharePercent || left.model.localeCompare(right.model) || left.speed.localeCompare(right.speed));
  }

  function normalizeModelBreakdown(payload) {
    const root = unwrapData(payload);
    const unitsValue = firstDefined(root, ['units']);
    const units = typeof unitsValue === 'string' ? unitsValue.trim().toLowerCase() : null;
    const sourceRows = Array.isArray(root)
      ? root
      : asArray(firstDefined(root, ['data', 'rows', 'daily', 'usage']));
    if (units !== 'percent') return { units, rows: [], dailyRows: [], supported: false };
    const dailyRows = sourceRows.map((dailyRow) => {
      if (!isRecord(dailyRow)) return null;
      const rawDate = firstDefined(dailyRow, ['date', 'day', 'usage_date', 'usageDate']);
      const date = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
        ? rawDate.slice(0, 10)
        : dateKeyUTC(parseTimestamp(rawDate));
      const modelRows = asArray(firstDefined(dailyRow, ['models', 'model_usage', 'modelUsage']));
      const rows = normalizeModelRows(modelRows.length ? modelRows : [dailyRow]);
      return date && rows.length ? { date, rows } : null;
    }).filter(Boolean).sort((left, right) => right.date.localeCompare(left.date));
    const aggregate = normalizeModelRows(dailyRows.flatMap((dailyRow) => dailyRow.rows));
    const total = aggregate.reduce((sum, row) => sum + row.sharePercent, 0);
    const rows = total > 0
      ? aggregate.map((row) => ({ ...row, sharePercent: row.sharePercent / total * 100 }))
      : [];
    return { units, rows, dailyRows, supported: true };
  }

  function estimateApiCost({ model, inputTokens, cachedInputTokens, outputTokens } = {}) {
    const tokenCounts = [inputTokens, cachedInputTokens, outputTokens].map(numberOrNull);
    if (tokenCounts.some((value) => value === null || value < 0)) {
      return createCostEstimate({ notes: ['模型级 Token attribution 不完整，无法计算 API 等价成本'] });
    }
    const pricing = typeof model === 'string' ? MODEL_PRICING[model] : null;
    if (!pricing || [pricing.inputPerMillion, pricing.cachedInputPerMillion, pricing.outputPerMillion].some((value) => numberOrNull(value) === null)) {
      return createCostEstimate({ notes: ['当前模型没有可用的独立定价条目'] });
    }
    const valueUsd = (tokenCounts[0] / 1_000_000) * pricing.inputPerMillion
      + (tokenCounts[1] / 1_000_000) * pricing.cachedInputPerMillion
      + (tokenCounts[2] / 1_000_000) * pricing.outputPerMillion;
    return createCostEstimate({ valueUsd, source: 'model_token_estimate', confidence: 'estimated', coveragePercent: 100, notes: ['API 等价估算，不代表 ChatGPT 真实服务端账单'] });
  }

  function resolveUsageCost({ threadCost, credits, tokenCost } = {}) {
    if (threadCost && numberOrNull(threadCost.valueUsd) !== null && threadCost.valueUsd >= 0) {
      return { ...threadCost };
    }
    const creditCost = usageCostProviders.creditProvider.resolveCost(credits);
    if (creditCost.valueUsd !== null) return creditCost;
    if (tokenCost && numberOrNull(tokenCost.valueUsd) !== null && tokenCost.valueUsd >= 0) {
      return { ...tokenCost };
    }
    return createCostEstimate({
      source: creditCost.source === 'credit-unavailable' ? 'credit-unavailable' : 'unavailable',
      confidence: 'unknown',
      notes: creditCost.notes
    });
  }

  function modelBreakdownCostEstimate() {
    const notes = runtime.state.modelBreakdown.rows.length
      ? ['当前接口提供模型占比，但未提供模型级 Token 明细']
      : ['模型占比接口不可用或没有非零数据，未获得模型级 Token 明细'];
    return createCostEstimate({ source: 'unavailable', confidence: 'unknown', notes });
  }

  function resolveTokenPricingCost() {
    return modelBreakdownCostEstimate();
  }

  function updateCostEstimate() {
    const cycle = runtime.state.analytics.ranges.cycle;
    const threadCost = runtime.state.threadUsageProvider.authoritativeCost;
    const tokenCost = usageCostProviders.tokenPricingProvider.resolve();
    runtime.state.costEstimate = resolveUsageCost({ threadCost, credits: cycle?.stats?.credits, tokenCost });
    runtime.state.diagnostics.costProviderSource = runtime.state.costEstimate.source;
    runtime.state.diagnostics.costConfidence = runtime.state.costEstimate.confidence;
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

  function removePreference(key) {
    try {
      localStorage.removeItem(key);
    } catch (_error) {
      // Private browsing and disabled storage are valid environments.
    }
  }

  function normalizeSectionCollapsed(value) {
    const stored = isRecord(value) ? value : {};
    return SECTION_IDS.reduce((result, id) => {
      result[id] = stored[id] === undefined ? DEFAULT_SECTION_COLLAPSED[id] : stored[id] === true;
      return result;
    }, {});
  }

  function normalizePositionAnchor(value) {
    if (!isRecord(value) || value.version !== POSITION_VERSION) return null;
    if (!['left', 'right'].includes(value.horizontal) || !['top', 'bottom'].includes(value.vertical)) return null;
    const offsetX = numberOrNull(value.offsetX);
    const offsetY = numberOrNull(value.offsetY);
    if (offsetX === null || offsetY === null || offsetX < 0 || offsetY < 0) return null;
    return {
      version: POSITION_VERSION,
      horizontal: value.horizontal,
      vertical: value.vertical,
      offsetX,
      offsetY
    };
  }

  function normalizeLegacyPosition(value) {
    if (!isRecord(value)) return null;
    const left = numberOrNull(value.left);
    const top = numberOrNull(value.top);
    return left !== null && top !== null ? { left, top } : null;
  }

  function loadPreferences() {
    removePreference(LEGACY_REFRESH_PREF_KEY);
    const storedPosition = readPreference(PREF_KEYS.position, DEFAULT_PREFS.position);
    return {
      position: normalizePositionAnchor(storedPosition),
      legacyPosition: normalizeLegacyPosition(storedPosition),
      collapsed: readPreference(PREF_KEYS.collapsed, DEFAULT_PREFS.collapsed) !== false,
      sectionCollapsed: normalizeSectionCollapsed(readPreference(PREF_KEYS.sections, DEFAULT_PREFS.sectionCollapsed)),
      range: RANGE_OPTIONS.includes(readPreference(PREF_KEYS.range, DEFAULT_PREFS.range)) ? readPreference(PREF_KEYS.range, DEFAULT_PREFS.range) : DEFAULT_PREFS.range,
      email: readPreference(PREF_KEYS.email, DEFAULT_PREFS.email) !== false,
      metric: readPreference(PREF_KEYS.metric, DEFAULT_PREFS.metric) === 'credits' ? 'credits' : 'tokens',
      customStart: typeof readPreference(PREF_KEYS.customStart, DEFAULT_PREFS.customStart) === 'string' ? readPreference(PREF_KEYS.customStart, DEFAULT_PREFS.customStart) : null,
      customEnd: typeof readPreference(PREF_KEYS.customEnd, DEFAULT_PREFS.customEnd) === 'string' ? readPreference(PREF_KEYS.customEnd, DEFAULT_PREFS.customEnd) : null
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
    const method = options.method || 'GET';
    const authMode = options.headers && (options.headers.Authorization || options.headers['ChatGPT-Account-Id']) ? 'auth' : 'cookie';
    const key = `${url}|${method}|${authMode}|${options.body || ''}`;
    if (runtime.inFlight.has(key)) return runtime.inFlight.get(key);
    const promise = (async () => {
      const controller = options.controller || new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method,
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json', ...(options.headers || {}) },
          body: options.body,
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

  function planDisplay(rawType) {
    const key = typeof rawType === 'string' ? rawType.toLowerCase() : '';
    if (PLAN_DISPLAY[key]) return PLAN_DISPLAY[key];
    if (/self[-_ ]?serve.*business|business.*self[-_ ]?serve/.test(key)) return PLAN_DISPLAY.business;
    if (/enterprise/.test(key)) return PLAN_DISPLAY.enterprise;
    if (/business/.test(key)) return PLAN_DISPLAY.business;
    return { label: rawType ? prettyName(String(rawType)) : '未提供', hint: '接口返回的未知套餐档位' };
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

  function cycleUsageAnalyzer(windows, now = Date.now()) {
    const candidates = asArray(windows)
      .filter((window) => window && window.durationSeconds > 0 && window.resetAt !== null && window.resetAt > now)
      .map((window) => {
        const startAt = window.resetAt - window.durationSeconds * 1000;
        return {
          window,
          startAt,
          endAt: window.resetAt,
          durationSeconds: window.durationSeconds,
          usedPercent: window.usedPercent,
          startDate: dateKeyUTC(startAt),
          endDateExclusive: addDays(dateKeyUTC(now), 1)
        };
      })
      .filter((cycle) => cycle.startDate !== null)
      .sort((left, right) => {
        const scopeOrder = (left.window.scope === 'primary' ? 0 : 1) - (right.window.scope === 'primary' ? 0 : 1);
        return scopeOrder || (left.endAt - now) - (right.endAt - now) || left.durationSeconds - right.durationSeconds;
      });
    return candidates[0] || {
      window: null,
      startAt: null,
      endAt: null,
      durationSeconds: null,
      usedPercent: null,
      startDate: null,
      endDateExclusive: addDays(dateKeyUTC(now), 1)
    };
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
      plan: { rawType: rawType === null ? null : String(rawType), ...planDisplay(rawType), allowed, limitReached },
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
      const totals = coalesceMetricValues(normalizeMetrics(firstDefined(item, ['totals', 'total'])), normalizeMetrics(item));
      totals.credits = readDailyCredits(item);
      const clients = asArray(firstDefined(item, ['clients', 'client_usage', 'clientUsage'])).map((client) => {
        if (!isRecord(client)) return null;
        const clientMetrics = coalesceMetricValues(normalizeMetrics(firstDefined(client, ['totals', 'total'])), normalizeMetrics(client));
        clientMetrics.credits = readDailyCredits(client);
        return { clientId: String(firstDefined(client, ['client_id', 'clientId', 'id', 'name']) || 'UNKNOWN'), metrics: clientMetrics };
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
    const seven = lastNDaysRange(7);
    const thirty = lastNDaysRange(30);
    const cycle = cycleUsageAnalyzer(windows, now);
    const cycleStart = cycle.startDate || thirty.start;
    const todayExclusive = addDays(todayKeyUTC(), 1);
    const cycleStats = aggregateRows(rows, cycleStart, cycle.endDateExclusive || todayExclusive);
    const estimatedTotalCredits = cycleStats.credits !== null && cycleStats.credits > 0 && cycle.usedPercent !== null && cycle.usedPercent > 0
      ? cycleStats.credits / (cycle.usedPercent / 100)
      : null;
    return {
      cycle: { label: cycle.window ? `当前周期 · ${cycle.window.label}` : '当前周期', start: cycleStart, end: cycle.endDateExclusive || todayExclusive, stats: cycleStats, estimatedTotalCredits, cycle },
      month: { label: '本月', start: monthStart, end: todayExclusive, stats: aggregateRows(rows, monthStart, todayExclusive) },
      '7d': { label: '近 7 天', start: seven.start, end: seven.end, stats: aggregateRows(rows, seven.start, seven.end) },
      '30d': { label: '近 30 天', start: thirty.start, end: thirty.end, stats: aggregateRows(rows, thirty.start, thirty.end) }
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
    const thirtyStart = lastNDaysRange(30).start;
    const starts = [monthStart, thirtyStart];
    if (runtime.prefs.range === 'custom' && runtime.prefs.customStart && runtime.prefs.customEnd && !validateCustomRange(runtime.prefs.customStart, runtime.prefs.customEnd, now)) starts.push(runtime.prefs.customStart);
    for (const window of windows) {
      if (window.resetAt && window.durationSeconds) starts.push(dateKeyUTC(window.resetAt - window.durationSeconds * 1000));
    }
    return { start: starts.filter(Boolean).sort()[0] || thirtyStart, end: lastNDaysRange(30).end };
  }

  function mergeDailyRows(currentRows, incomingRows) {
    const byDate = new Map(currentRows.map((row) => [row.date, row]));
    incomingRows.forEach((row) => byDate.set(row.date, row));
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function mergeCoverage(coverage, start, end) {
    const segments = [...coverage.segments, { start, end }].sort((left, right) => left.start.localeCompare(right.start));
    const merged = [];
    for (const segment of segments) {
      const previous = merged[merged.length - 1];
      if (previous && segment.start <= previous.end) previous.end = previous.end > segment.end ? previous.end : segment.end;
      else merged.push({ ...segment });
    }
    coverage.segments = merged;
    coverage.start = merged[0]?.start || null;
    coverage.end = merged[merged.length - 1]?.end || null;
  }

  function isRangeCovered(start, endExclusive) {
    return runtime.state.analytics.coverage.segments.some((segment) => segment.start <= start && segment.end >= endExclusive);
  }

  function rebuildAnalyticsRanges(now = Date.now()) {
    const analytics = runtime.state.analytics;
    const windows = runtime.state.data?.windows || [];
    analytics.ranges = deriveRanges(analytics.dailyRows, windows, now);
    if (runtime.prefs.customStart && runtime.prefs.customEnd && !validateCustomRange(runtime.prefs.customStart, runtime.prefs.customEnd, now)) {
      const range = inclusiveRangeToExclusiveRange(runtime.prefs.customStart, runtime.prefs.customEnd);
      analytics.ranges.custom = { label: `自定义 · ${runtime.prefs.customStart} — ${runtime.prefs.customEnd}`, start: range.start, end: range.end, stats: aggregateRows(analytics.dailyRows, range.start, range.end) };
    }
    const selected = analytics.ranges[runtime.prefs.range] || analytics.ranges[analytics.lastGoodRange] || analytics.ranges['30d'];
    analytics.clientRows = selected ? aggregateClients(analytics.dailyRows, selected.start, selected.end) : [];
    analytics.selectedBucketCount = selected?.stats?.dates || 0;
    updateCostEstimate();
  }

  async function fetchAnalyticsRange(start, endExclusive, headers = {}) {
    const analytics = runtime.state.analytics;
    if (isRangeCovered(start, endExclusive)) {
      analytics.cacheHit = true;
      rebuildAnalyticsRanges();
      return true;
    }
    if (runtime.analyticsPromise) {
      await runtime.analyticsPromise;
      return fetchAnalyticsRange(start, endExclusive, headers);
    }
    analytics.cacheHit = false;
    analytics.loading = true;
    analytics.error = null;
    analytics.lastRequest = { start, end: endExclusive };
    runtime.state.analyticsError = null;
    render();
    runtime.analyticsPromise = (async () => {
      const query = new URLSearchParams({ start_date: start, end_date: endExclusive, group_by: 'day' });
      const result = await requestJSON(`${ANALYTICS_ENDPOINT}?${query.toString()}`, { controller: runtime.abortController, headers });
      runtime.state.diagnostics.analyticsStatus = result.status;
      if (!result.ok || !result.data) {
        analytics.error = errorMessage(result, true);
        runtime.state.analyticsError = analytics.error;
        runtime.state.diagnostics.errors = [result.status || result.error || 'analytics'];
        return false;
      }
      const rows = normalizeDailyRows(result.data);
      analytics.dailyRows = mergeDailyRows(analytics.dailyRows, rows);
      mergeCoverage(analytics.coverage, start, endExclusive);
      analytics.error = null;
      runtime.state.analyticsError = null;
      runtime.state.diagnostics.dailyRows = analytics.dailyRows.length;
      rebuildAnalyticsRanges();
      runtime.state.diagnostics.clientTypes = analytics.clientRows.map((item) => item.clientId);
      return true;
    })().finally(() => {
      analytics.loading = false;
      runtime.analyticsPromise = null;
      render();
    });
    return runtime.analyticsPromise;
  }

  async function fetchModelBreakdown(headers = {}) {
    const modelBreakdown = runtime.state.modelBreakdown;
    if (runtime.modelBreakdownPromise) return runtime.modelBreakdownPromise;
    modelBreakdown.loading = true;
    modelBreakdown.error = null;
    render();
    runtime.modelBreakdownPromise = (async () => {
      const cycle = runtime.state.analytics.ranges.cycle;
      const start = cycle?.start || todayKeyUTC();
      const end = cycle?.end ? addDays(cycle.end, -1) : start;
      const query = new URLSearchParams({ start_date: start, end_date: end >= start ? end : start, group_by: 'day' });
      const result = await requestJSON(`${MODEL_BREAKDOWN_ENDPOINT}?${query.toString()}`, { controller: runtime.abortController, headers });
      runtime.state.diagnostics.modelBreakdownStatus = result.status;
      if (!result.ok || !result.data) {
        modelBreakdown.error = '模型使用情况暂不可用';
        modelBreakdown.stale = modelBreakdown.rows.length > 0;
        updateCostEstimate();
        return false;
      }
      const normalized = normalizeModelBreakdown(result.data);
      if (!normalized.supported) {
        modelBreakdown.error = '模型占比接口返回单位暂无法识别';
        modelBreakdown.stale = modelBreakdown.rows.length > 0;
        updateCostEstimate();
        return false;
      }
      modelBreakdown.units = normalized.units;
      modelBreakdown.rows = normalized.rows;
      modelBreakdown.dailyRows = normalized.dailyRows;
      modelBreakdown.stale = false;
      modelBreakdown.error = null;
      runtime.state.diagnostics.modelRows = normalized.rows.length;
      updateCostEstimate();
      return true;
    })().finally(() => {
      modelBreakdown.loading = false;
      runtime.modelBreakdownPromise = null;
      render();
    });
    return runtime.modelBreakdownPromise;
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

  const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const THREAD_TOKEN_FIELDS = Object.freeze(['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens']);
  const THREAD_USD_FIELDS = Object.freeze(['estimated_usage_usd_micros', 'estimatedUsageUsdMicros']);
  const THREAD_CREDIT_FIELDS = Object.freeze(['estimated_usage_credits_micros', 'estimatedUsageCreditsMicros']);

  function isValidThreadId(value) {
    return typeof value === 'string' && THREAD_ID_PATTERN.test(value.trim());
  }

  function currentPageThreadId() {
    const match = location.pathname.match(/^\/c\/([^/]+)/i);
    let candidate = '';
    try {
      candidate = match ? decodeURIComponent(match[1]) : '';
    } catch (_error) {
      candidate = '';
    }
    return isValidThreadId(candidate) ? candidate : '';
  }

  function containsAnyKey(value, keys, seen = new Set()) {
    if (Array.isArray(value)) return value.some((item) => containsAnyKey(item, keys, seen));
    if (!isRecord(value) || seen.has(value)) return false;
    seen.add(value);
    if (keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return true;
    return Object.values(value).some((item) => containsAnyKey(item, keys, seen));
  }

  function findNumericKey(value, keys, seen = new Set()) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findNumericKey(item, keys, seen);
        if (found !== null) return found;
      }
      return null;
    }
    if (!isRecord(value) || seen.has(value)) return null;
    seen.add(value);
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const number = numberOrNull(value[key]);
      if (number !== null) return number;
    }
    for (const item of Object.values(value)) {
      const found = findNumericKey(item, keys, seen);
      if (found !== null) return found;
    }
    return null;
  }

  function resolveThreadUsageCost(payload) {
    const micros = findNumericKey(payload, THREAD_USD_FIELDS);
    if (micros === null || micros < 0) {
      return createCostEstimate({ source: 'thread_api_unavailable', confidence: 'unknown', notes: ['Thread Usage 没有返回可用的权威 USD'] });
    }
    return createCostEstimate({
      valueUsd: micros / 1_000_000,
      source: 'thread_api',
      confidence: 'authoritative',
      coveragePercent: 100,
      notes: ['来源为 Thread Usage 服务端 USD；这是 API 等价价值，不代表 ChatGPT 订阅收费金额']
    });
  }

  function containsTokenFieldInGroups(value, seen = new Set()) {
    if (Array.isArray(value)) return value.some((item) => containsTokenFieldInGroups(item, seen));
    if (!isRecord(value) || seen.has(value)) return false;
    seen.add(value);
    const groups = value.groups;
    if (Array.isArray(groups) && groups.some((group) => isRecord(group) && THREAD_TOKEN_FIELDS.some((key) => Object.prototype.hasOwnProperty.call(group, key)))) return true;
    return Object.values(value).some((item) => containsTokenFieldInGroups(item, seen));
  }

  function inspectThreadUsageResponse(payload) {
    const root = unwrapData(payload);
    const threads = Array.isArray(root) ? root : asArray(firstDefined(root, ['threads']));
    return {
      hasThreads: threads.length > 0,
      supportsTokenBreakdown: containsTokenFieldInGroups(root),
      supportsUsdEstimate: containsAnyKey(root, THREAD_USD_FIELDS),
      supportsCreditEstimate: containsAnyKey(root, THREAD_CREDIT_FIELDS)
    };
  }

  function threadUsageErrorMessage(provider) {
    if (provider.status === 'available' && !provider.threadUsageSupported) return '接口可访问，但没有返回可查询线程数据';
    if (provider.status === 'unavailable' && provider.httpStatus === 403) return '接口存在，但当前账号可能没有开放线程级用量接口';
    if (provider.status === 'unavailable' && provider.httpStatus === 404) return '接口不可用或当前账号不可见';
    if (provider.status === 'unavailable' && provider.httpStatus === 401) return '请先登录 ChatGPT';
    if (provider.lastError === 'timeout') return '检测超时';
    if (provider.lastError === 'network') return '检测请求失败';
    if (provider.httpStatus === 400) return '线程 ID 无法查询或请求参数不被接口接受';
    if (provider.httpStatus === 429) return '请求过于频繁，请稍后再试';
    if (provider.httpStatus >= 500) return 'Thread Usage 接口暂时不可用';
    if (provider.status === 'error') return 'Thread Usage 能力检测失败';
    return '';
  }

  function threadUsageStatusLabel(provider) {
    if (provider.status === 'available') return '可用';
    if (provider.status === 'unavailable') return '不可用';
    if (provider.status === 'error') return '检测失败';
    return '未检测';
  }

  function updateThreadUsageProvider(result) {
    const provider = threadUsageProvider.createState();
    provider.checkedAt = Date.now();
    provider.httpStatus = result.status || null;
    provider.endpointAvailable = typeof result.status === 'number' && result.status !== 404 && result.status !== 0;
    if (result.error) {
      provider.status = 'error';
      provider.lastError = result.error;
      return provider;
    }
    if (result.status === 401 || result.status === 403 || result.status === 404) {
      provider.status = 'unavailable';
      provider.lastError = `http_${result.status}`;
      provider.endpointAvailable = result.status !== 404;
      return provider;
    }
    if (!result.ok || !result.data) {
      provider.status = 'error';
      provider.lastError = result.status ? `http_${result.status}` : 'empty_response';
      return provider;
    }
    const capabilities = threadUsageProvider.inspect(result.data);
    provider.status = 'available';
    provider.endpointAvailable = true;
    provider.threadUsageSupported = capabilities.hasThreads;
    provider.supportsTokenBreakdown = capabilities.supportsTokenBreakdown;
    provider.supportsUsdEstimate = capabilities.supportsUsdEstimate;
    provider.supportsCreditEstimate = capabilities.supportsCreditEstimate;
    provider.authoritativeCost = threadUsageProvider.resolveCost(result.data);
    return provider;
  }

  async function probeThreadUsage(threadId) {
    runtime.ui.threadUsageProbeLoading = true;
    runtime.ui.threadUsageValidationError = null;
    render();
    const controller = new AbortController();
    runtime.threadUsageAbortController?.abort();
    runtime.threadUsageAbortController = controller;
    const result = await requestWithSessionFallback(THREAD_USAGE_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ thread_ids: [threadId] }),
      controller,
      timeoutMs: THREAD_USAGE_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' }
    });
    if (runtime.threadUsageAbortController !== controller) return;
    runtime.threadUsageAbortController = null;
    runtime.state.threadUsageProvider = updateThreadUsageProvider(result.result);
    updateCostEstimate();
    runtime.ui.threadUsageProbeLoading = false;
    render();
  }

  function beginThreadUsageProbe() {
    const input = runtime.shadow?.querySelector('[name="thread-usage-id"]');
    const threadId = (input ? input.value : runtime.ui.threadUsageInput).trim();
    runtime.ui.threadUsageInput = threadId;
    runtime.ui.threadUsageValidationError = isValidThreadId(threadId) ? null : '请输入有效的 UUID 格式 Codex thread id';
    if (runtime.ui.threadUsageValidationError) {
      render();
      return;
    }
    void threadUsageProvider.probe(threadId);
  }

  function resetThreadUsageProbe() {
    runtime.threadUsageAbortController?.abort();
    runtime.threadUsageAbortController = null;
    runtime.state.threadUsageProvider = threadUsageProvider.createState();
    runtime.ui.threadUsageDialogOpen = false;
    runtime.ui.threadUsageInput = '';
    runtime.ui.threadUsageValidationError = null;
    runtime.ui.threadUsageProbeLoading = false;
  }

  async function requestWithSessionFallback(url, options = {}) {
    const cookieResult = await requestJSON(url, options);
    if (cookieResult.ok || (cookieResult.status !== 401 && cookieResult.status !== 403)) return { result: cookieResult, session: null, headers: {}, mode: 'cookie-only' };
    const sessionResult = await requestJSON(SESSION_ENDPOINT, { controller: options.controller });
    if (!sessionResult.ok) return { result: cookieResult, session: null, headers: {}, mode: 'cookie-only' };
    const token = getAccessToken(sessionResult.data);
    const accountId = getAccountId(sessionResult.data, token);
    const headers = {};
    if (typeof token === 'string' && token.trim()) headers.Authorization = `Bearer ${token}`;
    if (typeof accountId === 'string' && accountId.trim()) headers['ChatGPT-Account-Id'] = accountId;
    if (!Object.keys(headers).length) return { result: cookieResult, session: sessionResult.data, headers, mode: 'cookie-only' };
    const authenticated = await requestJSON(url, { ...options, headers: { ...(options.headers || {}), ...headers } });
    return { result: authenticated, session: sessionResult.data, headers, mode: 'authenticated-fallback' };
  }

  async function getUsageWithFallback(controller) {
    return requestWithSessionFallback(USAGE_ENDPOINT, { controller });
  }

  async function refresh() {
    if (runtime.refreshPromise) return runtime.refreshPromise;
    runtime.refreshPromise = (async () => {
      runtime.state.loading = true;
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
        if (runtime.state.signedIn === false) {
          runtime.state.data = null;
          runtime.state.analytics = createAnalyticsState();
          runtime.state.modelBreakdown = createModelBreakdownState();
          resetThreadUsageProbe();
          runtime.state.costEstimate = createCostEstimate({ notes: ['请先登录 ChatGPT 读取模型使用情况'] });
          runtime.state.analyticsError = null;
          runtime.state.diagnostics.analyticsStatus = null;
          runtime.state.diagnostics.modelBreakdownStatus = null;
          runtime.state.diagnostics.modelRows = 0;
          runtime.state.diagnostics.costProviderSource = 'unknown';
          runtime.state.diagnostics.costConfidence = 'unknown';
          runtime.state.diagnostics.dailyRows = 0;
          runtime.state.diagnostics.clientTypes = [];
          runtime.lastUsageHeaders = {};
        }
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
        runtime.state.analytics = createAnalyticsState();
        runtime.state.modelBreakdown = createModelBreakdownState();
        resetThreadUsageProbe();
        runtime.state.costEstimate = createCostEstimate({ notes: ['账户已切换，等待新的模型使用数据'] });
        runtime.state.analyticsError = null;
        runtime.state.diagnostics.analyticsStatus = null;
        runtime.state.diagnostics.modelBreakdownStatus = null;
        runtime.state.diagnostics.modelRows = 0;
        runtime.state.diagnostics.costProviderSource = 'unknown';
        runtime.state.diagnostics.costConfidence = 'unknown';
        runtime.state.diagnostics.dailyRows = 0;
        runtime.state.diagnostics.clientTypes = [];
      }
      runtime.accountFingerprint = fingerprint;
      runtime.lastUsageHeaders = usageBundle.headers;
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
      runtime.state.data = normalized;
      rebuildAnalyticsRanges(startedAt);
      runtime.state.fetchedAt = startedAt;
      runtime.state.loading = false;
      runtime.state.stale = false;
      runtime.state.error = null;
      render();
      const range = analyticsRequestRange(normalized.windows, startedAt);
      const results = await Promise.all([
        fetchModelBreakdown(usageBundle.headers),
        fetchAnalyticsRange(range.start, range.end, usageBundle.headers)
      ]);
      if (!results[0] || !results[1]) normalized.partial = true;
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

  function collapsibleSection(id, title, content, defaultCollapsed = false) {
    const collapsed = runtime.prefs.sectionCollapsed[id] ?? defaultCollapsed;
    const sectionId = `wt-section-${id}`;
    const node = setAttributes(el('section', 'wt-section wt-collapsible'), { 'data-section': id });
    const toggle = setAttributes(el('button', 'wt-section-toggle'), {
      type: 'button',
      'aria-controls': sectionId,
      'aria-expanded': !collapsed,
      'data-action': 'toggle-section',
      'data-section-id': id
    });
    toggle.append(el('span', 'wt-section-title', title), el('span', 'wt-section-chevron', '⌄'));
    const body = setAttributes(el('div', 'wt-section-body'), { id: sectionId, hidden: collapsed ? 'true' : null });
    if (content) body.append(content);
    node.append(toggle, body);
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
      bar.style.setProperty('--wt-progress-color', getQuotaProgressColor(percent));
      bar.setAttribute('aria-valuenow', String(percent));
      bar.setAttribute('aria-valuetext', `${formatPercent(percent)} 已使用`);
    }
    wrapper.append(bar);
    return wrapper;
  }

  function renderWindow(window) {
    const card = el('article', 'wt-window');
    const heading = el('div', 'wt-window-heading');
    const windowStatus = window.limitReached === true ? '已达到限制' : window.allowed === false ? '不可用' : window.allowed === true ? '可用' : '状态未提供';
    heading.append(el('strong', 'wt-window-label', window.label), statusBadge(windowStatus, window.limitReached === true ? 'danger' : window.allowed === false ? 'warning' : window.allowed === true ? 'ok' : 'warning'));
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

  function avatarInitial(name) {
    if (typeof name !== 'string' || !name.trim()) return '·';
    const value = name.trim();
    return /^[A-Za-z]/.test(value) ? value[0].toUpperCase() : value[0];
  }

  function formatUpdatedAt(value) {
    const timestamp = parseTimestamp(value);
    if (timestamp === null) return '更新时间未提供';
    const date = new Date(timestamp);
    const today = todayKeyUTC();
    return dateKeyUTC(timestamp) === today
      ? `更新于 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)}`
      : `更新于 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)}`;
  }

  function renderAccountSummary(data) {
    if (data.session.signedIn === false) return el('div', 'wt-notice wt-notice-warning', '当前未登录 ChatGPT，登录后可查看账户用量。');
    if (data.session.signedIn !== true) return el('div', 'wt-notice wt-notice-warning', '登录状态暂无法确认，请稍后刷新。');
    const node = el('div', 'wt-account-summary');
    const identity = el('div', 'wt-identity-block');
    identity.append(el('span', 'wt-avatar', avatarInitial(data.session.displayName)));
    const copy = el('div', 'wt-identity-copy');
    if (hasValue(data.session.displayName)) copy.append(el('strong', 'wt-account-name', data.session.displayName));
    if (runtime.prefs.email && hasValue(data.session.maskedEmail)) copy.append(el('span', 'wt-account-email', data.session.maskedEmail));
    identity.append(copy);
    const side = el('div', 'wt-account-side');
    side.append(setAttributes(statusBadge(data.plan.label, 'plan'), { title: `${data.plan.hint}；实际当前额度以额度窗口为准` }));
    const usageStatus = data.plan.limitReached === true ? '已达到额度限制' : data.plan.allowed === false ? '当前不可用' : data.plan.allowed === true ? '可用' : '状态未提供';
    const status = el('span', `wt-account-status wt-account-status-${data.plan.limitReached === true || data.plan.allowed === false ? 'danger' : data.plan.allowed === true ? 'ok' : 'warning'}`);
    status.append(el('span', 'wt-status-dot-inline'), el('span', '', usageStatus));
    side.append(status);
    node.append(identity, side, el('div', 'wt-account-meta', formatUpdatedAt(data.fetchedAt)));
    const credits = renderCredits(data);
    if (credits) node.append(credits);
    return node;
  }

  function renderCredits(data) {
    const values = [data.credits.hasCredits, data.credits.unlimited, data.credits.balance, data.credits.resetCreditsAvailable, data.spendControl.reached, data.spendControl.used, data.spendControl.limit, data.spendControl.usedPercent, data.spendControl.remainingPercent, data.spendControl.resetAt];
    if (!values.some(hasValue)) return null;
    const node = el('div', 'wt-subsection wt-account-credits');
    node.append(el('h4', 'wt-subtitle', '账户状态'));
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
    const grid = el('div', 'wt-metric-grid');
    const metrics = [['tokens', 'Tokens'], ['turns', 'Turns'], ['threads', 'Threads']];
    metrics.forEach(([key, label]) => {
      if (!hasValue(stats[key])) return;
      const card = el('div', 'wt-metric');
      card.append(el('span', 'wt-metric-label', label), el('strong', 'wt-metric-value', formatNumber(stats[key])));
      grid.append(card);
    });
    const secondary = [['cachedInputTokens', 'Cached input'], ['uncachedInputTokens', 'Uncached input'], ['outputTokens', 'Output tokens'], ['dates', '有数据的日期']].filter(([key]) => hasValue(stats[key]));
    if (secondary.length) {
      const details = el('details', 'wt-secondary-metrics');
      details.append(el('summary', '更多统计'));
      const detailGrid = el('div', 'wt-field-grid');
      secondary.forEach(([key, label]) => detailGrid.append(field(label, formatNumber(stats[key]))));
      details.append(detailGrid);
      grid.append(details);
    }
    return grid;
  }

  function formatCompactNumber(value) {
    const number = numberOrNull(value);
    if (number === null) return '未提供';
    const absolute = Math.abs(number);
    if (absolute >= 1_000_000) return `${(number / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
    if (absolute >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return formatNumber(number);
  }

  function estimatedCycleCredits(cycle, stats) {
    const usedCredits = numberOrNull(stats?.credits);
    const usedPercent = numberOrNull(cycle?.usedPercent);
    if (usedCredits === null || usedCredits <= 0 || usedPercent === null || usedPercent <= 0) return null;
    return usedCredits / (usedPercent / 100);
  }

  function renderCycleAnalysis(data) {
    const range = runtime.state.analytics.ranges.cycle;
    const cycle = range?.cycle || cycleUsageAnalyzer(data?.windows || []);
    const stats = range?.stats || normalizeMetrics({});
    const wrapper = el('div', 'wt-cycle-content');
    if (cycle.window) {
      wrapper.append(el('p', 'wt-range-caption', `当前周期：${cycle.window.label} · ${formatDate(cycle.startAt)} — ${formatDate(cycle.endAt)}`));
    } else {
      wrapper.append(el('p', 'wt-notice wt-notice-warning', '接口未提供可计算的当前周期窗口。'));
    }
    if (!range || runtime.state.analytics.loading && !runtime.state.analytics.dailyRows.length) {
      wrapper.append(el('p', 'wt-notice wt-notice-info', '正在读取周期统计。'));
    }
    const grid = el('div', 'wt-metric-grid wt-cycle-metric-grid');
    const metrics = [
      ['tokens', 'Tokens', stats.tokens === null ? '未提供' : formatCompactNumber(stats.tokens)],
      ['turns', 'Turns', stats.turns === null ? '未提供' : formatNumber(stats.turns)],
      ['threads', 'Threads', stats.threads === null ? '未提供' : formatNumber(stats.threads)]
    ];
    metrics.forEach(([, label, value]) => {
      const card = el('div', 'wt-metric');
      card.append(el('span', 'wt-metric-label', label), el('strong', 'wt-metric-value', value));
      grid.append(card);
    });
    wrapper.append(grid);
    const estimatedTotalCredits = range?.estimatedTotalCredits ?? estimatedCycleCredits(cycle, stats);
    const estimate = el('div', 'wt-notice wt-notice-info');
    estimate.append(el('strong', '', '周期额度推算：'), el('span', '', estimatedTotalCredits === null ? '暂无法推算' : `${formatNumber(estimatedTotalCredits)} Credits`));
    if (cycle.usedPercent !== null) estimate.append(el('span', 'wt-window-meta', `（已使用 ${formatPercent(cycle.usedPercent)}）`));
    wrapper.append(estimate, renderDailyBreakdown(range));
    const dailyModelUsage = renderDailyModelUsage();
    if (dailyModelUsage) wrapper.append(dailyModelUsage);
    return wrapper;
  }

  function renderDailyBreakdown(range) {
    const wrapper = el('div', 'wt-subsection wt-daily-breakdown');
    wrapper.append(el('h4', 'wt-subtitle', '每日明细'));
    const rows = range?.stats?.rows || [];
    if (!rows.length) {
      wrapper.append(el('p', 'wt-empty', '当前周期没有可显示的每日数据'));
      return wrapper;
    }
    const table = el('table', 'wt-daily-table');
    const head = el('thead');
    const headerRow = el('tr');
    ['日期', 'Tokens', 'Turns', 'Threads', '主要模型'].forEach((label) => headerRow.append(el('th', '', label)));
    head.append(headerRow);
    const body = el('tbody');
    rows.slice().reverse().forEach((row) => {
      const tr = el('tr');
      const tokenText = row.metrics.tokens === null ? '未提供' : formatCompactNumber(row.metrics.tokens);
      const model = runtime.state.modelBreakdown.dailyRows.find((item) => item.date === row.date)?.rows[0];
      const mainModel = model ? `${formatModelName(model.model)} · ${formatModelSpeed(model.speed)}` : '未提供';
      [row.date, tokenText, row.metrics.turns === null ? '未提供' : formatNumber(row.metrics.turns), row.metrics.threads === null ? '未提供' : formatNumber(row.metrics.threads), mainModel].forEach((value) => tr.append(el('td', '', value)));
      body.append(tr);
    });
    table.append(head, body);
    wrapper.append(table);
    return wrapper;
  }

  function renderModelUsage() {
    const modelBreakdown = runtime.state.modelBreakdown;
    const wrapper = el('div', 'wt-subsection wt-model-usage');
    wrapper.append(el('h4', 'wt-subtitle', '模型使用占比'));
    if (modelBreakdown.loading) wrapper.append(el('p', 'wt-notice wt-notice-info', '正在读取模型使用情况。'));
    if (modelBreakdown.error) wrapper.append(el('p', 'wt-notice wt-notice-warning', `${modelBreakdown.error}；不会把该接口字段当作余额或 Token 数量。`));
    if (!modelBreakdown.rows.length) {
      if (!modelBreakdown.loading && !modelBreakdown.error) wrapper.append(el('p', 'wt-empty', '当前接口没有可显示的非零模型占比'));
      return wrapper;
    }
    if (modelBreakdown.stale) wrapper.append(el('p', 'wt-notice wt-notice-warning', '模型使用情况显示上次成功结果。'));
    wrapper.append(el('p', 'wt-window-meta', '数据来自 Analytics；百分比表示模型使用占比，不代表 Credits 或 Tokens。'));
    const chartShell = el('div', 'wt-model-pie-shell');
    const visual = setAttributes(el('div', 'wt-model-pie'), {
      role: 'img',
      'aria-label': `模型使用占比：${modelBreakdown.rows.map((row) => `${formatModelName(row.model)} ${formatUsageShare(row.sharePercent)}`).join('，')}`
    });
    let cursor = 0;
    const stops = modelBreakdown.rows.map((row, index) => {
      const start = cursor;
      cursor += row.sharePercent;
      return `${modelUsageColor(index)} ${start}% ${cursor}%`;
    });
    visual.style.background = `conic-gradient(${stops.join(', ')})`;
    chartShell.append(visual);
    const legend = el('div', 'wt-model-pie-legend');
    const tooltip = setAttributes(el('div', 'wt-pie-tooltip'), { role: 'tooltip', hidden: 'true', 'aria-hidden': 'true' });
    const showTooltip = (item, temporary = false) => {
      tooltip.textContent = item.dataset.tooltip || '';
      tooltip.hidden = false;
      tooltip.setAttribute('aria-hidden', 'false');
      if (temporary) setTimeout(() => { tooltip.hidden = true; tooltip.setAttribute('aria-hidden', 'true'); }, 2200);
    };
    const hideTooltip = () => {
      tooltip.hidden = true;
      tooltip.setAttribute('aria-hidden', 'true');
    };
    modelBreakdown.rows.forEach((row, index) => {
      const item = setAttributes(el('div', 'wt-model-pie-item'), {
        tabindex: 0,
        role: 'img',
        'aria-label': `${formatModelName(row.model)}，${formatModelSpeed(row.speed)}，${formatUsageShare(row.sharePercent)}`,
        'data-tooltip': `${formatModelName(row.model)} · ${formatModelSpeed(row.speed)}：${formatUsageShare(row.sharePercent)}`
      });
      item.append(el('span', 'wt-model-pie-swatch'), el('span', 'wt-model-pie-label', `${formatModelName(row.model)} · ${formatModelSpeed(row.speed)}`), el('strong', 'wt-model-usage-share', formatUsageShare(row.sharePercent)));
      item.firstChild.style.background = modelUsageColor(index);
      item.addEventListener('pointerenter', () => showTooltip(item));
      item.addEventListener('pointerleave', hideTooltip);
      item.addEventListener('focus', () => showTooltip(item));
      item.addEventListener('blur', hideTooltip);
      item.addEventListener('click', () => showTooltip(item, true));
      legend.append(item);
    });
    chartShell.append(legend, tooltip);
    wrapper.append(chartShell);
    return wrapper;
  }

  function modelUsageColor(index) {
    const colors = ['#3b82f6', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];
    return colors[index % colors.length];
  }

  function renderDailyModelUsage() {
    const dailyRows = runtime.state.modelBreakdown.dailyRows;
    if (!dailyRows.length) return null;
    const wrapper = el('div', 'wt-subsection wt-daily-model-usage');
    wrapper.append(el('h4', 'wt-subtitle', '每日模型使用'));
    for (const dailyRow of dailyRows) {
      const day = el('div', 'wt-daily-model-day');
      day.append(el('strong', 'wt-daily-model-date', dailyRow.date));
      for (const row of dailyRow.rows) {
        const item = el('div', 'wt-daily-model-row');
        item.append(el('span', 'wt-model-usage-name', `${formatModelName(row.model)} · ${formatModelSpeed(row.speed)}`), el('strong', 'wt-model-usage-share', formatUsageShare(row.sharePercent)));
        day.append(item);
      }
      wrapper.append(day);
    }
    return wrapper;
  }

  function renderAnalytics(data) {
    const analytics = runtime.state.analytics;
    const node = el('div', 'wt-usage-content');
    node.append(renderRangeSelector());
    if (runtime.prefs.range === 'custom') node.append(renderCustomRangeEditor());
    const range = analytics.ranges[runtime.prefs.range] || analytics.ranges[analytics.lastGoodRange] || analytics.ranges['30d'];
    if (analytics.loading) node.append(el('p', 'wt-notice wt-notice-info', '正在读取所选日期范围，当前统计仍可使用。'));
    if (analytics.error) {
      node.append(el('p', 'wt-notice wt-notice-warning', `${analytics.error}；可通过标题栏 Analytics 图标查看官方页面。`));
    }
    if (!range || !range.stats || (!analytics.dailyRows.length && !analytics.loading)) {
      node.append(el('p', 'wt-empty', '当前账号或套餐未提供详细 Analytics'));
      node.append(renderModelUsage());
      return node;
    }
    node.append(el('p', 'wt-range-caption', `当前范围：${range.label}`), renderStats(range.stats), renderModelUsage(), renderClientRows(analytics.clientRows, range.stats.tokens), renderChart(range.stats.rows));
    return node;
  }

  function renderRangeSelector() {
    const group = setAttributes(el('div', 'wt-range-selector'), { role: 'tablist', 'aria-label': '统计范围' });
    RANGE_PRESETS.forEach((preset, index) => {
      const active = runtime.prefs.range === preset.id;
      const button = setAttributes(el('button', `wt-range-button${active ? ' wt-range-button-active' : ''}`, preset.id === 'custom' && runtime.prefs.customStart && runtime.prefs.customEnd ? '自定义' : preset.label.replace('近 ', '')), { type: 'button', role: 'tab', 'aria-selected': active, tabindex: active ? 0 : -1, 'data-range': preset.id });
      button.addEventListener('click', () => selectAnalyticsRange(preset.id));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? RANGE_PRESETS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + RANGE_PRESETS.length) % RANGE_PRESETS.length;
        const next = group.querySelectorAll('[data-range]')[nextIndex];
        next?.focus();
        selectAnalyticsRange(RANGE_PRESETS[nextIndex].id);
      });
      group.append(button);
    });
    return group;
  }

  function renderCustomRangeEditor() {
    const form = el('form', 'wt-custom-range');
    const fields = el('div', 'wt-date-fields');
    const startLabel = el('label', 'wt-date-label', '开始日期');
    const start = setAttributes(el('input', 'wt-date-input'), { type: 'date', name: 'start', required: 'true', value: runtime.prefs.customStart || '', max: todayKeyUTC() });
    startLabel.append(start);
    const endLabel = el('label', 'wt-date-label', '结束日期');
    const end = setAttributes(el('input', 'wt-date-input'), { type: 'date', name: 'end', required: 'true', value: runtime.prefs.customEnd || '', max: todayKeyUTC() });
    endLabel.append(end);
    fields.append(startLabel, endLabel);
    const error = setAttributes(el('p', 'wt-date-error'), { 'aria-live': 'polite' });
    const hint = el('p', 'wt-date-hint', '结束日期包含当天；范围按 UTC 日期桶统计。');
    const actions = el('div', 'wt-custom-actions');
    const apply = setAttributes(el('button', 'wt-button', '应用'), { type: 'submit' });
    const cancel = setAttributes(el('button', 'wt-button wt-button-secondary', '取消'), { type: 'button' });
    const clear = setAttributes(el('button', 'wt-button wt-button-quiet', '清除并恢复默认'), { type: 'button' });
    cancel.addEventListener('click', () => { runtime.prefs.range = runtime.state.analytics.lastGoodRange; render(); });
    clear.addEventListener('click', () => { runtime.prefs.customStart = null; runtime.prefs.customEnd = null; writePreference(PREF_KEYS.customStart, null); writePreference(PREF_KEYS.customEnd, null); runtime.prefs.range = DEFAULT_PREFS.range; runtime.state.analytics.lastGoodRange = DEFAULT_PREFS.range; writePreference(PREF_KEYS.range, DEFAULT_PREFS.range); render(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = validateCustomRange(start.value, end.value);
      error.textContent = message || '';
      if (message) return;
      const previous = runtime.state.analytics.lastGoodRange;
      runtime.prefs.customStart = start.value;
      runtime.prefs.customEnd = end.value;
      writePreference(PREF_KEYS.customStart, start.value);
      writePreference(PREF_KEYS.customEnd, end.value);
      const range = inclusiveRangeToExclusiveRange(start.value, end.value);
      const loaded = await fetchAnalyticsRange(range.start, range.end, runtime.lastUsageHeaders || {});
      if (loaded) {
        runtime.prefs.range = 'custom';
        runtime.state.analytics.lastGoodRange = 'custom';
        rebuildAnalyticsRanges();
      } else {
        runtime.prefs.range = previous;
      }
      render();
    });
    actions.append(apply, cancel, clear);
    form.append(fields, hint, error, actions);
    return form;
  }

  async function selectAnalyticsRange(id) {
    if (id === 'custom') {
      runtime.prefs.range = 'custom';
      writePreference(PREF_KEYS.range, 'custom');
      render();
      return;
    }
    const range = runtime.state.analytics.ranges[id];
    if (!range) return;
    runtime.prefs.range = id;
    runtime.state.analytics.lastGoodRange = id;
    runtime.state.analytics.cacheHit = isRangeCovered(range.start, range.end);
    writePreference(PREF_KEYS.range, id);
    rebuildAnalyticsRanges();
    render();
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
      const heading = el('div', 'wt-client-heading');
      heading.append(el('strong', 'wt-client-name', prettyName(row.clientId, '其他未知客户端')), el('span', 'wt-client-share', formatPercent(row.tokenShare)));
      item.append(heading, el('span', 'wt-client-value', `${formatNumber(row.tokens)} Tokens · ${formatNumber(row.threads)} Threads · ${formatNumber(row.turns)} Turns`));
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
    const metricLabel = runtime.prefs.metric === 'credits' ? 'Credits' : 'Tokens';
    const chartShell = el('div', 'wt-chart-shell');
    const chart = el('div', 'wt-chart-scroll');
    const tooltip = setAttributes(el('div', 'wt-chart-tooltip'), { role: 'tooltip', hidden: 'true', 'aria-hidden': 'true' });
    const tooltipDate = el('span', 'wt-chart-tooltip-date');
    const tooltipValue = el('strong', 'wt-chart-tooltip-value');
    tooltip.append(tooltipDate, tooltipValue);

    const hideTooltip = () => {
      if (runtime.ui.tooltipTimer) {
        clearTimeout(runtime.ui.tooltipTimer);
        runtime.ui.tooltipTimer = null;
      }
      tooltip.hidden = true;
      tooltip.setAttribute('aria-hidden', 'true');
    };
    const showTooltip = (column, temporary = false) => {
      if (runtime.ui.tooltipTimer) clearTimeout(runtime.ui.tooltipTimer);
      tooltipDate.textContent = column.dataset.tooltipDate || '';
      tooltipValue.textContent = column.dataset.tooltipValue || '';
      tooltip.hidden = false;
      tooltip.setAttribute('aria-hidden', 'false');
      const columnRect = column.getBoundingClientRect();
      const shellRect = chartShell.getBoundingClientRect();
      const gap = 8;
      let left = columnRect.left - shellRect.left + columnRect.width / 2;
      let top = columnRect.top - shellRect.top - gap;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.transform = 'translate(-50%, -100%)';
      const halfWidth = tooltip.offsetWidth / 2;
      left = Math.max(halfWidth + 4, Math.min(shellRect.width - halfWidth - 4, left));
      if (top - tooltip.offsetHeight < 4) {
        top = columnRect.bottom - shellRect.top + gap;
        tooltip.style.transform = 'translateX(-50%)';
      }
      top = Math.max(4, Math.min(shellRect.height - tooltip.offsetHeight - 4, top));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      if (temporary) runtime.ui.tooltipTimer = setTimeout(hideTooltip, 2200);
    };

    for (const item of values) {
      const column = el('div', 'wt-chart-column');
      const formattedValue = formatChartMetricValue(runtime.prefs.metric, item.value);
      setAttributes(column, {
        tabindex: 0,
        role: 'img',
        'aria-label': `${item.date}，${metricLabel} ${formattedValue}`,
        'data-tooltip-date': item.date,
        'data-tooltip-value': `${metricLabel} ${formattedValue}`
      });
      const bar = el('div', 'wt-chart-bar');
      bar.style.height = `${Math.max(3, item.value / max * 100)}%`;
      column.append(bar, el('span', 'wt-chart-label', item.date.slice(5)));
      column.addEventListener('pointerenter', () => showTooltip(column));
      column.addEventListener('pointerleave', hideTooltip);
      column.addEventListener('focus', () => showTooltip(column));
      column.addEventListener('blur', hideTooltip);
      column.addEventListener('click', () => showTooltip(column, true));
      column.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        hideTooltip();
      });
      chart.append(column);
    }
    chart.addEventListener('scroll', hideTooltip, { passive: true });
    chartShell.addEventListener('click', (event) => {
      if (!event.target.closest?.('.wt-chart-column')) hideTooltip();
    });
    chartShell.append(chart, tooltip);
    wrapper.append(chartShell);
    return wrapper;
  }

  function formatChartMetricValue(metric, value) {
    const number = numberOrNull(value);
    if (number === null) return '未提供';
    return new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: metric === 'credits' ? 6 : 0,
      minimumFractionDigits: 0,
      useGrouping: true
    }).format(metric === 'credits' ? number : Math.round(number));
  }

  function analyticsIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    setAttributes(svg, { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    setAttributes(path, { d: 'M4 19V5m0 14h16M7 16v-5m4 5V8m4 8v-3m4 3V4', fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '1.7' });
    svg.append(path);
    return svg;
  }

  function officialLink(href, label, icon) {
    const link = setAttributes(el('a', 'wt-icon-button'), { href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label, title: label });
    link.append(icon());
    return link;
  }

  function safeDiagnosticPath() {
    return location.pathname.split('/').map((segment) => isValidThreadId(segment) ? '[redacted]' : segment).join('/');
  }

  function creditDiagnosticAvailable() {
    return runtime.state.analytics.dailyRows.some((row) => numberOrNull(row.metrics?.credits) !== null && row.metrics.credits > 0);
  }

  function creditDiagnosticSource() {
    return creditDiagnosticAvailable() ? 'daily-workspace' : 'unavailable';
  }

  function dataSourceStatus(status, available = false) {
    if (available) return 'available';
    return typeof status === 'number' && status >= 200 && status < 300 ? 'available' : 'unavailable';
  }

  function renderDiagnostics() {
    const content = el('div', 'wt-diagnostics');
    const sources = el('div', 'wt-data-sources');
    sources.append(el('h4', 'wt-subtitle', 'Data Sources'));
    const sourceGrid = el('div', 'wt-field-grid');
    sourceGrid.append(
      field('Workspace Analytics', dataSourceStatus(runtime.state.diagnostics.analyticsStatus, runtime.state.analytics.dailyRows.length > 0)),
      field('Model Breakdown', dataSourceStatus(runtime.state.diagnostics.modelBreakdownStatus, runtime.state.modelBreakdown.units === 'percent')),
      field('Thread Usage', runtime.state.threadUsageProvider.status === 'available' ? 'available' : 'unavailable'),
      field('Credit', creditDiagnosticAvailable() ? 'available' : 'unavailable'),
      field('costCapability', 'unavailable')
    );
    sources.append(sourceGrid);
    content.append(sources);
    const lines = [
      ['脚本版本', VERSION], ['当前路径', safeDiagnosticPath()], ['Usage HTTP 状态', runtime.state.diagnostics.usageStatus || '未请求'],
      ['Analytics HTTP 状态', runtime.state.diagnostics.analyticsStatus || '未请求'], ['model breakdown status', runtime.state.diagnostics.modelBreakdownStatus || '未请求'],
      ['model rows count', runtime.state.diagnostics.modelRows], ['请求模式', runtime.state.diagnostics.usageMode],
      ['获取时间', formatDate(runtime.state.fetchedAt)], ['原始 plan_type', runtime.state.data && runtime.state.data.plan.rawType],
      ['当前选中范围', runtime.prefs.range], ['自定义开始日期', runtime.prefs.customStart || '未提供'], ['自定义结束日期', runtime.prefs.customEnd || '未提供'],
      ['Analytics coverage', runtime.state.analytics.coverage.start ? `${runtime.state.analytics.coverage.start}..${runtime.state.analytics.coverage.end}` : '未覆盖'],
      ['最后一次 Analytics 请求范围', runtime.state.analytics.lastRequest ? `${runtime.state.analytics.lastRequest.start}..${runtime.state.analytics.lastRequest.end}` : '未请求'],
      ['命中内存 coverage', runtime.state.analytics.cacheHit ? '是' : '否'], ['当前范围日期桶数', runtime.state.analytics.selectedBucketCount],
      ['成功解析窗口数量', runtime.state.diagnostics.windowCount], ['主额度窗口数量', runtime.state.diagnostics.primaryWindowCount], ['额外额度窗口数量', runtime.state.diagnostics.additionalWindowCount], ['每日数据行数', runtime.state.diagnostics.dailyRows],
      ['客户端类型', runtime.state.diagnostics.clientTypes.join(', ') || '未提供'], ['未识别顶层字段', runtime.state.diagnostics.unknownFields.join(', ') || '无'], ['错误代码', runtime.state.diagnostics.errors.join(', ') || '无']
    ];
    for (const [label, value] of lines) content.append(field(label, value));
    for (const window of runtime.state.diagnostics.windows) {
      const summary = `${window.label} · ${window.sourcePath}`;
      content.append(field('窗口', `${summary} · 周期 ${window.durationSeconds === null ? '未提供' : `${window.durationSeconds} 秒`} · used ${window.hasUsedPercent ? '已识别' : '未提供'} · resetAt ${window.hasResetAt ? '已识别' : '未提供'}`));
    }
    const copy = el('button', 'wt-button wt-button-secondary', '复制诊断信息');
    copy.type = 'button';
    copy.dataset.action = 'copy-diagnostics';
    content.append(copy);
    return collapsibleSection('diagnostics', '诊断信息', content, true);
  }

  function diagnosticText() {
    const lines = [
      `脚本版本: ${VERSION}`, `当前路径: ${safeDiagnosticPath()}`, `Usage HTTP 状态: ${runtime.state.diagnostics.usageStatus || '未请求'}`,
      `Analytics HTTP 状态: ${runtime.state.diagnostics.analyticsStatus || '未请求'}`, `model breakdown status: ${runtime.state.diagnostics.modelBreakdownStatus || '未请求'}`, `model rows count: ${runtime.state.diagnostics.modelRows}`, `请求模式: ${runtime.state.diagnostics.usageMode}`,
      `获取时间: ${formatDate(runtime.state.fetchedAt)}`, `原始 plan_type: ${runtime.state.data ? runtime.state.data.plan.rawType || '未提供' : '未提供'}`,
      `当前选中范围: ${runtime.prefs.range}`, `自定义开始日期: ${runtime.prefs.customStart || '未提供'}`, `自定义结束日期: ${runtime.prefs.customEnd || '未提供'}`,
      `Analytics coverage: ${runtime.state.analytics.coverage.start ? `${runtime.state.analytics.coverage.start}..${runtime.state.analytics.coverage.end}` : '未覆盖'}`,
      `最后一次 Analytics 请求范围: ${runtime.state.analytics.lastRequest ? `${runtime.state.analytics.lastRequest.start}..${runtime.state.analytics.lastRequest.end}` : '未请求'}`,
      `命中内存 coverage: ${runtime.state.analytics.cacheHit ? '是' : '否'}`, `当前范围日期桶数: ${runtime.state.analytics.selectedBucketCount}`,
      `Workspace Analytics=${dataSourceStatus(runtime.state.diagnostics.analyticsStatus, runtime.state.analytics.dailyRows.length > 0)}`, `Model Breakdown=${dataSourceStatus(runtime.state.diagnostics.modelBreakdownStatus, runtime.state.modelBreakdown.units === 'percent')}`, `Thread Usage=${runtime.state.threadUsageProvider.status === 'available' ? 'available' : 'unavailable'}`, `Credit=${creditDiagnosticAvailable() ? 'available' : 'unavailable'}`, 'costCapability=unavailable',
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

  function refreshIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    setAttributes(svg, { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    setAttributes(path, { d: 'M20 11a8 8 0 0 0-14.7-4L4 9m0-4v4h4M4 13a8 8 0 0 0 14.7 4L20 15m0 4v-4h-4', fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '1.7' });
    svg.append(path);
    return svg;
  }

  function statusKind() {
    if (runtime.state.error || runtime.state.data?.windows.some((item) => item.limitReached === true)) return 'danger';
    if (runtime.state.stale || runtime.state.analyticsError || runtime.state.loading || runtime.state.analytics.loading || runtime.state.modelBreakdown.loading || runtime.state.modelBreakdown.error || runtime.state.modelBreakdown.stale || runtime.state.data?.windows.some((item) => item.allowed === null || item.resetAt === null)) return 'warning';
    return 'ok';
  }

  function renderCollapsedLauncher() {
    const statusText = runtime.state.error || runtime.state.data?.windows.some((item) => item.limitReached === true) ? '已达到额度限制或发生错误' : runtime.state.stale || runtime.state.analyticsError || runtime.state.loading || runtime.state.analytics.loading || runtime.state.modelBreakdown.loading || runtime.state.modelBreakdown.error ? 'Analytics 部分不可用或正在加载' : '数据正常';
    const launcher = setAttributes(el('button', 'wt-launcher wt-drag-handle'), { type: 'button', 'aria-label': '打开账户用量面板', title: `账户用量 · ${statusText}` });
    launcher.append(usageIcon(), el('span', `wt-status-dot wt-status-dot-${statusKind()}`));
    return launcher;
  }

  function renderExpandedPanel() {
    const shell = el('div', 'wt-shell');
    const header = el('div', 'wt-header wt-drag-handle');
    const title = el('div', 'wt-title-group');
    title.append(el('strong', 'wt-title', '用量与额度'), el('span', 'wt-title-status', runtime.state.loading ? '读取中…' : runtime.state.modelBreakdown.loading ? '模型使用情况读取中…' : runtime.state.analytics.loading ? 'Analytics 读取中…' : runtime.state.fetchedAt ? formatUpdatedAt(runtime.state.fetchedAt) : '更新时间未提供'));
    const controls = el('div', 'wt-header-controls');
    const refreshBusy = runtime.state.loading || runtime.state.analytics.loading || runtime.state.modelBreakdown.loading;
    const refreshButton = setAttributes(el('button', `wt-icon-button${refreshBusy ? ' wt-icon-button-loading' : ''}`), { type: 'button', 'aria-label': '刷新账户用量', title: refreshBusy ? '正在刷新账户用量' : '刷新账户用量', 'aria-busy': refreshBusy, disabled: refreshBusy ? 'true' : null });
    refreshButton.append(refreshIcon());
    refreshButton.dataset.action = 'refresh';
    controls.append(refreshButton);
    controls.append(officialLink(ANALYTICS_URL, '打开官方 Analytics', analyticsIcon));
    const toggle = setAttributes(el('button', 'wt-icon-button'), { type: 'button', 'aria-label': '收起账户用量面板', title: '收起账户用量面板', 'aria-expanded': 'true' });
    toggle.append(el('span', 'wt-close-icon', '×'));
    toggle.dataset.action = 'toggle';
    controls.append(toggle);
    header.append(title, controls);
    shell.append(header);
    const body = el('div', 'wt-body');
    if (runtime.state.loading && !runtime.state.data) body.append(el('div', 'wt-loading', '正在读取账户与额度…'));
    if (runtime.state.error) body.append(el('div', `wt-notice ${runtime.state.data ? 'wt-notice-warning' : 'wt-notice-danger'}`, `${runtime.state.data ? '刷新未完成，继续显示上次成功数据：' : ''}${runtime.state.error}`));
    if (runtime.state.data) {
      body.append(collapsibleSection('account', '账户摘要', renderAccountSummary(runtime.state.data)));
      const windows = el('div', 'wt-quota-content');
      if (runtime.state.data.windows.length) runtime.state.data.windows.forEach((item) => windows.append(renderWindow(item)));
      else windows.append(el('p', 'wt-empty', '接口未提供有效额度窗口'));
      body.append(collapsibleSection('quota', '额度窗口', windows));
      body.append(collapsibleSection('stats', '使用统计', renderAnalytics(runtime.state.data)));
      body.append(collapsibleSection('cycle', '周期分析', renderCycleAnalysis(runtime.state.data)));
    }
    body.addEventListener('scroll', () => {
      const tooltip = runtime.shadow?.querySelector('.wt-chart-tooltip');
      if (tooltip) {
        tooltip.hidden = true;
        tooltip.setAttribute('aria-hidden', 'true');
      }
    }, { passive: true });
    body.append(renderDiagnostics());
    shell.append(body);
    return shell;
  }

  function captureExpandedPanelState() {
    const body = runtime.shadow?.querySelector('.wt-body');
    if (!body || runtime.host?.getAttribute('data-wt-mode') !== 'expanded') return null;
    const active = runtime.shadow.activeElement;
    let focus = null;
    if (active && body.contains(active)) {
      if (active.dataset.range) focus = { type: 'range', value: active.dataset.range };
      else if (active.dataset.action) focus = { type: 'action', value: active.dataset.action };
      else if (active.classList.contains('wt-chart-select')) focus = { type: 'metric', value: active.value };
      else if (active.name) focus = { type: 'name', value: active.name };
      else if (active.tagName === 'SUMMARY') focus = { type: 'summary' };
    }
    return {
      session: runtime.ui.panelSession,
      scrollTop: body.scrollTop,
      focus,
      details: [...body.querySelectorAll('details')].map((detail) => detail.open),
      sections: SECTION_IDS.map((id) => ({ id, collapsed: runtime.prefs.sectionCollapsed[id] === true }))
    };
  }

  function restoreExpandedPanelState(state) {
    if (!state || state.session !== runtime.ui.panelSession || runtime.prefs.collapsed) return;
    const body = runtime.shadow?.querySelector('.wt-body');
    if (!body) return;
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    body.scrollTop = Math.min(Math.max(0, state.scrollTop), maxScrollTop);
    [...body.querySelectorAll('details')].forEach((detail, index) => {
      if (state.details[index] !== undefined) detail.open = state.details[index];
    });
    for (const sectionState of state.sections || []) {
      const section = [...body.querySelectorAll('[data-section]')].find((node) => node.dataset.section === sectionState.id);
      const sectionBody = section?.querySelector('.wt-section-body');
      const toggle = section?.querySelector('[data-action="toggle-section"]');
      if (!sectionBody || !toggle) continue;
      sectionBody.hidden = sectionState.collapsed;
      toggle.setAttribute('aria-expanded', String(!sectionState.collapsed));
    }
    const focus = state.focus;
    if (!focus) return;
    let target = null;
    if (focus.type === 'range') target = [...body.querySelectorAll('[data-range]')].find((node) => node.dataset.range === focus.value);
    if (focus.type === 'action') target = [...body.querySelectorAll('[data-action]')].find((node) => node.dataset.action === focus.value);
    if (focus.type === 'metric') target = body.querySelector('.wt-chart-select');
    if (focus.type === 'name') target = [...body.querySelectorAll('[name]')].find((node) => node.name === focus.value);
    if (focus.type === 'summary') target = body.querySelector('summary');
    target?.focus({ preventScroll: true });
  }

  function render() {
    if (!runtime.app || !runtime.host) return;
    clearTimeout(runtime.ui.tooltipTimer);
    runtime.ui.tooltipTimer = null;
    cancelPositionFrame();
    const wasExpanded = runtime.host.getAttribute('data-wt-mode') === 'expanded';
    const willBeExpanded = !runtime.prefs.collapsed;
    const capturedState = wasExpanded && willBeExpanded ? captureExpandedPanelState() : null;
    const preservedState = willBeExpanded && runtime.ui.pendingPanelState?.session === runtime.ui.panelSession
      ? runtime.ui.pendingPanelState
      : capturedState;
    if (!wasExpanded && willBeExpanded) runtime.ui.panelSession += 1;
    if (!willBeExpanded) {
      runtime.ui.pendingPanelState = null;
      if (runtime.ui.tooltipTimer) clearTimeout(runtime.ui.tooltipTimer);
      runtime.ui.tooltipTimer = null;
    }
    runtime.app.replaceChildren();
    syncTheme();
    runtime.host.setAttribute('data-wt-mode', runtime.prefs.collapsed ? 'collapsed' : 'expanded');
    runtime.app.append(runtime.prefs.collapsed ? renderCollapsedLauncher() : renderExpandedPanel());
    applyPosition();
    schedulePositionApplication();
    if (preservedState) {
      runtime.ui.pendingPanelState = preservedState;
      requestAnimationFrame(() => {
        const state = runtime.ui.pendingPanelState;
        runtime.ui.pendingPanelState = null;
        restoreExpandedPanelState(state);
      });
    }
  }

  function detectPageTheme() {
    const roots = [document.documentElement, document.body].filter(Boolean);
    for (const root of roots) {
      const explicit = root.getAttribute('data-theme') || root.getAttribute('data-color-scheme') || root.getAttribute('theme');
      if (/^dark$/i.test(explicit || '')) return 'dark';
      if (/^light$/i.test(explicit || '')) return 'light';
    }
    if (roots.some((root) => root.classList.contains('dark') || root.classList.contains('dark-mode'))) return 'dark';
    if (roots.some((root) => root.classList.contains('light') || root.classList.contains('light-mode'))) return 'light';
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    if (/dark/i.test(scheme) && !/light/i.test(scheme)) return 'dark';
    if (/light/i.test(scheme) && !/dark/i.test(scheme)) return 'light';
    const background = getComputedStyle(document.body || document.documentElement).backgroundColor;
    const match = background.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
    if (match && (Number(match[1]) * 299 + Number(match[2]) * 587 + Number(match[3]) * 114) / 1000 < 128) return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncTheme() {
    if (runtime.host) runtime.host.setAttribute('data-wt-theme', detectPageTheme());
  }

  function cancelPositionFrame() {
    if (runtime.ui.positionFrame === null) return;
    cancelAnimationFrame(runtime.ui.positionFrame);
    runtime.ui.positionFrame = null;
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function currentHostSize() {
    const rect = runtime.host?.getBoundingClientRect();
    return {
      width: rect?.width || runtime.host?.offsetWidth || 400,
      height: rect?.height || runtime.host?.offsetHeight || 200
    };
  }

  function anchorFromRect(rect) {
    const horizontal = rect.left + rect.width / 2 <= window.innerWidth / 2 ? 'left' : 'right';
    const vertical = rect.top + rect.height / 2 <= window.innerHeight / 2 ? 'top' : 'bottom';
    return {
      version: POSITION_VERSION,
      horizontal,
      vertical,
      offsetX: Math.max(0, horizontal === 'left' ? rect.left : window.innerWidth - rect.right),
      offsetY: Math.max(0, vertical === 'top' ? rect.top : window.innerHeight - rect.bottom)
    };
  }

  function clampAnchorForViewport(anchor) {
    const { width, height } = currentHostSize();
    const rawLeft = anchor.horizontal === 'left' ? anchor.offsetX : window.innerWidth - width - anchor.offsetX;
    const rawTop = anchor.vertical === 'top' ? anchor.offsetY : window.innerHeight - height - anchor.offsetY;
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX);
    const maxTop = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - height - VIEWPORT_MARGIN_PX);
    const left = clampNumber(rawLeft, VIEWPORT_MARGIN_PX, maxLeft);
    const top = clampNumber(rawTop, VIEWPORT_MARGIN_PX, maxTop);
    return {
      ...anchor,
      offsetX: anchor.horizontal === 'left' ? left : Math.max(0, window.innerWidth - width - left),
      offsetY: anchor.vertical === 'top' ? top : Math.max(0, window.innerHeight - height - top)
    };
  }

  function applyPositionAnchor(anchor) {
    if (!runtime.host) return;
    const effective = clampAnchorForViewport(anchor || DEFAULT_POSITION_ANCHOR);
    runtime.host.style.left = effective.horizontal === 'left' ? `${effective.offsetX}px` : 'auto';
    runtime.host.style.right = effective.horizontal === 'right' ? `${effective.offsetX}px` : 'auto';
    runtime.host.style.top = effective.vertical === 'top' ? `${effective.offsetY}px` : 'auto';
    runtime.host.style.bottom = effective.vertical === 'bottom' ? `${effective.offsetY}px` : 'auto';
  }

  function applyTemporaryPosition(left, top) {
    const { width, height } = currentHostSize();
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX);
    const maxTop = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - height - VIEWPORT_MARGIN_PX);
    runtime.host.style.left = `${clampNumber(left, VIEWPORT_MARGIN_PX, maxLeft)}px`;
    runtime.host.style.top = `${clampNumber(top, VIEWPORT_MARGIN_PX, maxTop)}px`;
    runtime.host.style.right = 'auto';
    runtime.host.style.bottom = 'auto';
  }

  function migrateLegacyPosition() {
    const legacyPosition = runtime.prefs.legacyPosition;
    if (!runtime.host || !legacyPosition) return;
    applyTemporaryPosition(legacyPosition.left, legacyPosition.top);
    const anchor = anchorFromRect(runtime.host.getBoundingClientRect());
    runtime.prefs.position = anchor;
    runtime.prefs.legacyPosition = null;
    writePreference(PREF_KEYS.position, anchor);
  }

  function applyPosition() {
    if (!runtime.host) return;
    if (runtime.prefs.legacyPosition) {
      applyTemporaryPosition(runtime.prefs.legacyPosition.left, runtime.prefs.legacyPosition.top);
      return;
    }
    applyPositionAnchor(runtime.prefs.position || DEFAULT_POSITION_ANCHOR);
  }

  function schedulePositionApplication() {
    cancelPositionFrame();
    runtime.ui.positionFrame = requestAnimationFrame(() => {
      runtime.ui.positionFrame = null;
      if (!runtime.host) return;
      if (runtime.prefs.legacyPosition) migrateLegacyPosition();
      applyPosition();
    });
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
      applyTemporaryPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
    };
    const end = (endEvent) => {
      if (ended) return;
      ended = true;
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', end);
      surface.removeEventListener('pointercancel', end);
      surface.releasePointerCapture?.(event.pointerId);
      if (moved && endEvent?.type !== 'pointercancel') {
        const anchor = anchorFromRect(runtime.host.getBoundingClientRect());
        runtime.prefs.position = anchor;
        runtime.prefs.legacyPosition = null;
        writePreference(PREF_KEYS.position, anchor);
        applyPositionAnchor(anchor);
        runtime.dragSuppressUntil = Date.now() + 250;
      } else if (moved) {
        applyPosition();
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
    } else if (action === 'toggle-section') {
      const id = actionTarget.dataset.sectionId;
      if (!SECTION_IDS.includes(id)) return;
      runtime.prefs.sectionCollapsed[id] = !runtime.prefs.sectionCollapsed[id];
      writePreference(PREF_KEYS.sections, runtime.prefs.sectionCollapsed);
      render();
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
    const backoff = runtime.state.diagnostics.usageStatus === 429 || runtime.state.diagnostics.analyticsStatus === 429 ? 600_000 : 0;
    runtime.refreshTimer = setTimeout(() => refresh(), Math.max(AUTO_REFRESH_INTERVAL_MS, backoff));
  }

  function createStyle() {
    const style = document.createElement('style');
    style.textContent = `
      :host { --wt-color-bg: #ffffff; --wt-color-surface: #f7f7f8; --wt-color-surface-secondary: #f0f0f1; --wt-color-text: #202123; --wt-color-text-secondary: #5f6368; --wt-color-text-tertiary: #8b8d91; --wt-color-border: #d9d9df; --wt-color-border-subtle: #e8e8eb; --wt-color-primary: #202123; --wt-color-primary-hover: #35363a; --wt-color-primary-text: #ffffff; --wt-color-focus: #2563eb; --wt-color-success: #159447; --wt-color-warning: #b86a08; --wt-color-danger: #c43d32; --wt-color-chart: #3b82f6; --wt-shadow: 0 14px 40px rgba(0,0,0,.16); color: var(--wt-color-text); display: block; font: 13px/1.45 ui-sans-serif, -apple-system, system-ui, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; position: fixed; width: min(400px, calc(100vw - 24px)); z-index: 100000; }
      :host([data-wt-theme="dark"]) { --wt-color-bg: #202123; --wt-color-surface: #2a2b2f; --wt-color-surface-secondary: #34353a; --wt-color-text: #f7f7f8; --wt-color-text-secondary: #b5b5bd; --wt-color-text-tertiary: #8f9198; --wt-color-border: #4a4b52; --wt-color-border-subtle: #38393e; --wt-color-primary: #f7f7f8; --wt-color-primary-hover: #ffffff; --wt-color-primary-text: #202123; --wt-color-focus: #70a7ff; --wt-color-success: #48c774; --wt-color-warning: #f1ad42; --wt-color-danger: #ff7b72; --wt-color-chart: #75a7ff; --wt-shadow: 0 18px 48px rgba(0,0,0,.52); }
      :host([data-wt-mode="collapsed"]) { height: 46px; width: 46px; } :host([data-wt-mode="expanded"]) { max-width: calc(100vw - 24px); }
      .wt-shell { background: var(--wt-color-bg); border: 1px solid var(--wt-color-border); border-radius: 16px; box-shadow: var(--wt-shadow); max-width: 100%; overflow: hidden; }
      .wt-header { align-items: center; background: var(--wt-color-bg); border-bottom: 1px solid var(--wt-color-border-subtle); cursor: grab; display: flex; gap: 12px; justify-content: space-between; padding: 14px 16px 12px; user-select: none; } .wt-header:active { cursor: grabbing; } .wt-title-group { flex: 1 1 auto; min-width: 0; } .wt-title { display: block; font-size: 15px; font-weight: 600; letter-spacing: -.01em; } .wt-title-status { color: var(--wt-color-text-tertiary); display: block; font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .wt-header-controls { align-items: center; display: flex; flex: 0 0 auto; gap: 4px; }
      button, select, input, a { font: inherit; } button, a, select, input { -webkit-tap-highlight-color: transparent; } button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--wt-color-focus); outline-offset: 2px; }
      .wt-icon-button, .wt-button, .wt-select { border: 1px solid var(--wt-color-border); border-radius: 8px; cursor: pointer; min-height: 40px; padding: 6px 10px; text-decoration: none; } .wt-icon-button { align-items: center; background: transparent; box-sizing: border-box; color: var(--wt-color-text-secondary); display: inline-flex; flex: 0 0 40px; height: 40px; justify-content: center; min-height: 40px; min-width: 40px; padding: 0; width: 40px; } .wt-icon-button:hover { background: var(--wt-color-surface); color: var(--wt-color-text); } .wt-icon-button svg { flex: 0 0 18px; height: 18px; width: 18px; } .wt-icon-button-loading svg { animation: wt-spin .8s linear infinite; } .wt-close-icon { font-size: 22px; font-weight: 300; line-height: 1; } .wt-button { background: var(--wt-color-primary); border-color: var(--wt-color-primary); color: var(--wt-color-primary-text); } .wt-button:hover { background: var(--wt-color-primary-hover); } .wt-button-secondary, .wt-select { background: var(--wt-color-surface); color: var(--wt-color-text); } .wt-button-quiet { background: transparent; border-color: transparent; color: var(--wt-color-text-secondary); }
      .wt-launcher { align-items: center; background: var(--wt-color-bg); border: 1px solid var(--wt-color-border); border-radius: 13px; box-shadow: 0 5px 18px rgba(0,0,0,.14); color: var(--wt-color-text); cursor: grab; display: inline-flex; height: 46px; justify-content: center; padding: 0; position: relative; touch-action: none; user-select: none; width: 46px; } .wt-launcher:hover { background: var(--wt-color-surface); } .wt-launcher:active { cursor: grabbing; } .wt-launcher svg { height: 23px; width: 23px; } .wt-status-dot { border: 2px solid var(--wt-color-bg); border-radius: 50%; bottom: 4px; height: 8px; position: absolute; right: 4px; width: 8px; } .wt-status-dot-ok { background: var(--wt-color-success); } .wt-status-dot-warning { background: var(--wt-color-warning); } .wt-status-dot-danger { background: var(--wt-color-danger); }
      .wt-body { max-height: 70vh; overflow: auto; padding: 0 16px 16px; } .wt-section { border-top: 1px solid var(--wt-color-border-subtle); padding: 16px 0 0; } .wt-section-title, .wt-subtitle { font-size: 13px; font-weight: 600; margin: 0 0 10px; } .wt-subtitle { color: var(--wt-color-text-secondary); font-size: 12px; }
      .wt-account-summary { align-items: center; display: grid; gap: 4px 10px; grid-template-columns: minmax(0, 1fr) auto; padding: 16px 0 14px; } .wt-identity-block { align-items: center; display: flex; gap: 10px; min-width: 0; } .wt-avatar { align-items: center; background: var(--wt-color-surface-secondary); border-radius: 50%; color: var(--wt-color-text-secondary); display: inline-flex; flex: 0 0 34px; font-size: 15px; font-weight: 600; height: 34px; justify-content: center; width: 34px; } .wt-identity-copy { display: flex; flex-direction: column; min-width: 0; } .wt-account-name, .wt-account-email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .wt-account-name { font-size: 13px; font-weight: 600; } .wt-account-email { color: var(--wt-color-text-secondary); font-size: 11px; margin-top: 2px; } .wt-account-side { align-items: flex-end; display: flex; flex-direction: column; gap: 5px; } .wt-account-meta { color: var(--wt-color-text-tertiary); font-size: 11px; grid-column: 1 / -1; padding-left: 44px; } .wt-account-status { align-items: center; color: var(--wt-color-text-secondary); display: inline-flex; font-size: 11px; gap: 5px; } .wt-account-status-ok { color: var(--wt-color-success); } .wt-account-status-warning { color: var(--wt-color-warning); } .wt-account-status-danger { color: var(--wt-color-danger); } .wt-status-dot-inline { background: currentColor; border-radius: 50%; height: 7px; width: 7px; }
      .wt-field-grid { display: grid; gap: 8px 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); } .wt-field { display: flex; flex-direction: column; min-width: 0; } .wt-field-label { color: var(--wt-color-text-secondary); font-size: 11px; } .wt-field-value { overflow-wrap: anywhere; }
      .wt-badge { background: var(--wt-color-surface-secondary); border-radius: 9999px; color: var(--wt-color-text-secondary); display: inline-block; font-size: 11px; font-weight: 500; padding: 4px 8px; white-space: nowrap; } .wt-badge-plan { background: var(--wt-color-surface-secondary); color: var(--wt-color-text); } .wt-badge-ok { color: var(--wt-color-success); } .wt-badge-warning { color: var(--wt-color-warning); } .wt-badge-danger { color: var(--wt-color-danger); }
      .wt-window { background: var(--wt-color-bg); border: 1px solid var(--wt-color-border-subtle); border-radius: 11px; margin: 8px 0; padding: 12px; } .wt-window-heading, .wt-subsection-heading, .wt-client-heading { align-items: center; display: flex; gap: 8px; justify-content: space-between; } .wt-window-meta, .wt-empty, .wt-notice, .wt-loading, .wt-range-caption { color: var(--wt-color-text-secondary); font-size: 12px; margin: 6px 0; } .wt-progress-wrap { margin: 9px 0; } .wt-progress { background: var(--wt-color-surface-secondary); border-radius: 9999px; height: 6px; overflow: hidden; position: relative; } .wt-progress::after { background: var(--wt-color-chart); border-radius: inherit; content: ''; display: block; height: 100%; width: var(--wt-progress, 0%); } .wt-window-percent-unknown { color: var(--wt-color-warning); }
      .wt-notice { border: 1px solid var(--wt-color-border-subtle); border-radius: 10px; padding: 10px; } .wt-notice-warning { color: var(--wt-color-warning); } .wt-notice-danger { color: var(--wt-color-danger); } .wt-notice-info { color: var(--wt-color-text-secondary); } .wt-subsection { border-top: 1px solid var(--wt-color-border-subtle); margin-top: 16px; padding-top: 12px; } .wt-client-row { border-bottom: 1px solid var(--wt-color-border-subtle); padding: 9px 0; } .wt-client-name, .wt-client-value { display: block; } .wt-client-share { color: var(--wt-color-text-secondary); font-size: 11px; } .wt-client-value { color: var(--wt-color-text-secondary); font-size: 11px; margin-top: 3px; } .wt-model-usage-row { border-bottom: 1px solid var(--wt-color-border-subtle); padding: 9px 0; } .wt-model-usage-heading { align-items: center; display: flex; gap: 8px; justify-content: space-between; } .wt-model-usage-name, .wt-model-usage-speed { display: block; } .wt-model-usage-share { color: var(--wt-color-text); font-variant-numeric: tabular-nums; font-weight: 600; } .wt-model-usage-speed { color: var(--wt-color-text-secondary); font-size: 11px; margin-top: 3px; } .wt-cost-value { font-variant-numeric: tabular-nums; font-weight: 600; margin: 8px 0 0; } .wt-cost-meta { margin-top: 8px; }
      .wt-metric-grid { border: 1px solid var(--wt-color-border-subtle); border-radius: 11px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: hidden; } .wt-metric { border-bottom: 1px solid var(--wt-color-border-subtle); display: flex; flex-direction: column; min-width: 0; padding: 11px; } .wt-metric:nth-child(odd) { border-right: 1px solid var(--wt-color-border-subtle); } .wt-metric:nth-last-child(-n+2) { border-bottom: 0; } .wt-metric-label { color: var(--wt-color-text-secondary); font-size: 11px; } .wt-metric-value { font-size: 17px; font-weight: 600; margin-top: 3px; } .wt-secondary-metrics { border-top: 1px solid var(--wt-color-border-subtle); grid-column: 1 / -1; padding: 9px 11px; } .wt-secondary-metrics summary, .wt-diagnostics summary { color: var(--wt-color-text-secondary); cursor: pointer; font-size: 12px; font-weight: 500; }
      .wt-range-selector { display: flex; gap: 3px; margin-bottom: 10px; max-width: 100%; overflow-x: auto; padding: 2px; scrollbar-width: thin; } .wt-range-button { background: transparent; border: 1px solid transparent; border-radius: 8px; color: var(--wt-color-text-secondary); cursor: pointer; flex: 0 0 auto; min-height: 36px; padding: 6px 10px; white-space: nowrap; } .wt-range-button:hover { background: var(--wt-color-surface); color: var(--wt-color-text); } .wt-range-button-active { background: var(--wt-color-surface-secondary); border-color: var(--wt-color-border); color: var(--wt-color-text); font-weight: 600; }
      .wt-custom-range { background: var(--wt-color-surface); border-radius: 10px; margin-bottom: 10px; padding: 10px; } .wt-date-fields { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); } .wt-date-label { color: var(--wt-color-text-secondary); display: flex; flex-direction: column; font-size: 11px; gap: 4px; } .wt-date-input { background: var(--wt-color-bg); border: 1px solid var(--wt-color-border); border-radius: 8px; color: var(--wt-color-text); min-height: 38px; min-width: 0; padding: 7px; } .wt-date-hint { color: var(--wt-color-text-tertiary); font-size: 11px; margin: 7px 0 0; } .wt-date-error { color: var(--wt-color-danger); font-size: 11px; min-height: 16px; margin: 5px 0 0; } .wt-custom-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .wt-chart-shell { position: relative; } .wt-chart-scroll { align-items: end; border-bottom: 1px solid var(--wt-color-border); display: flex; gap: 4px; height: 132px; overflow-x: auto; padding: 8px 2px 0; } .wt-chart-column { align-items: center; border-radius: 4px; display: flex; flex: 1 0 16px; flex-direction: column; height: 100%; justify-content: end; min-width: 16px; } .wt-chart-column:focus-visible { outline: 2px solid var(--wt-color-focus); outline-offset: 2px; } .wt-chart-bar { background: var(--wt-color-chart); border-radius: 3px 3px 0 0; min-height: 3px; width: 100%; } .wt-chart-label { color: var(--wt-color-text-tertiary); font-size: 9px; margin-top: 4px; white-space: nowrap; } .wt-chart-tooltip { background: var(--wt-color-surface); border: 1px solid var(--wt-color-border); border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 18%); color: var(--wt-color-text); display: flex; flex-direction: column; font-size: 11px; max-width: calc(100% - 8px); padding: 7px 9px; pointer-events: none; position: absolute; white-space: nowrap; z-index: 2; } .wt-chart-tooltip[hidden] { display: none; } .wt-chart-tooltip-date { color: var(--wt-color-text-secondary); } .wt-chart-tooltip-value { font-variant-numeric: tabular-nums; margin-top: 2px; }
      .wt-daily-table { border-collapse: collapse; font-size: 11px; min-width: 100%; table-layout: auto; } .wt-daily-table th, .wt-daily-table td { border-bottom: 1px solid var(--wt-color-border-subtle); padding: 8px 5px; text-align: right; white-space: nowrap; } .wt-daily-table th:first-child, .wt-daily-table td:first-child { text-align: left; } .wt-daily-table th { color: var(--wt-color-text-secondary); font-size: 10px; font-weight: 500; } .wt-daily-breakdown { overflow-x: auto; } .wt-cost-diagnostics { border: 1px solid var(--wt-color-border-subtle); border-radius: 10px; margin: 8px 0 12px; padding: 10px; }
      .wt-diagnostics { border-top: 1px solid var(--wt-color-border-subtle); margin-top: 12px; padding-top: 10px; } .wt-diagnostics summary { margin-bottom: 8px; } .wt-diagnostics .wt-field { margin: 6px 0; } .wt-thread-usage { border-top: 1px solid var(--wt-color-border-subtle); margin-top: 10px; padding-top: 10px; } .wt-thread-usage-dialog { background: var(--wt-color-surface); border: 1px solid var(--wt-color-border); border-radius: 10px; margin-top: 10px; padding: 10px; } .wt-thread-usage-prompt, .wt-thread-usage-label { color: var(--wt-color-text-secondary); font-size: 12px; } .wt-thread-usage-prompt { margin: 6px 0 8px; } .wt-thread-usage-label { display: flex; flex-direction: column; gap: 4px; } .wt-thread-usage-input { background: var(--wt-color-bg); border: 1px solid var(--wt-color-border); border-radius: 8px; color: var(--wt-color-text); min-height: 38px; min-width: 0; padding: 7px; } .wt-thread-usage-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; } .wt-button:disabled, .wt-icon-button:disabled { cursor: wait; opacity: .6; } .wt-loading { min-height: 120px; padding-top: 18px; } .wt-chart-select { margin-left: auto; }
      @keyframes wt-spin { to { transform: rotate(360deg); } } @media (max-width: 480px) { :host([data-wt-mode="expanded"]) { width: calc(100vw - 24px); } .wt-body { max-height: 68vh; padding-left: 12px; padding-right: 12px; } .wt-header { padding-left: 12px; padding-right: 12px; } } @media (max-width: 340px) { .wt-account-summary { align-items: start; } .wt-account-side { align-items: flex-start; grid-column: 1 / -1; padding-left: 44px; } .wt-date-fields { grid-template-columns: 1fr; } .wt-range-button { padding-left: 8px; padding-right: 8px; } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
    `;
    style.textContent += `
      .wt-progress::after { background: var(--wt-progress-color, var(--wt-color-chart)); }
      .wt-section-toggle { align-items: center; background: transparent; border: 0; color: var(--wt-color-text); cursor: pointer; display: flex; font: inherit; justify-content: space-between; min-height: 36px; padding: 0; text-align: left; width: 100%; }
      .wt-section-toggle:hover { color: var(--wt-color-primary-hover); }
      .wt-section-toggle .wt-section-title { margin: 0; }
      .wt-section-chevron { color: var(--wt-color-text-secondary); font-size: 17px; line-height: 1; transition: transform 140ms ease; }
      .wt-section-toggle[aria-expanded="false"] .wt-section-chevron { transform: rotate(-90deg); }
      .wt-section-body { padding-bottom: 2px; }
      .wt-account-credits { margin-top: 12px; }
      .wt-model-pie-shell { align-items: center; display: grid; gap: 14px; grid-template-columns: 132px minmax(0, 1fr); margin-top: 10px; position: relative; }
      .wt-model-pie { aspect-ratio: 1; border: 1px solid var(--wt-color-border); border-radius: 50%; box-shadow: inset 0 0 0 22px var(--wt-color-bg); min-width: 0; }
      .wt-model-pie-legend { min-width: 0; }
      .wt-model-pie-item { align-items: center; border-bottom: 1px solid var(--wt-color-border-subtle); cursor: default; display: grid; gap: 6px; grid-template-columns: 9px minmax(0, 1fr) auto; padding: 7px 0; }
      .wt-model-pie-item:focus-visible { outline: 2px solid var(--wt-color-focus); outline-offset: 2px; }
      .wt-model-pie-swatch { border-radius: 50%; height: 9px; width: 9px; }
      .wt-model-pie-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wt-pie-tooltip { background: var(--wt-color-surface); border: 1px solid var(--wt-color-border); border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 18%); color: var(--wt-color-text); font-size: 11px; left: 50%; max-width: calc(100% - 8px); padding: 7px 9px; pointer-events: none; position: absolute; top: 4px; transform: translateX(-50%); white-space: nowrap; z-index: 2; }
      .wt-pie-tooltip[hidden] { display: none; }
      .wt-daily-model-day { border-bottom: 1px solid var(--wt-color-border-subtle); padding: 8px 0; }
      .wt-daily-model-date { display: block; margin-bottom: 4px; }
      .wt-daily-model-row { align-items: center; color: var(--wt-color-text-secondary); display: flex; font-size: 11px; gap: 8px; justify-content: space-between; padding: 3px 0; }
      .wt-daily-model-row .wt-model-usage-share { color: var(--wt-color-text); }
      @media (max-width: 340px) { .wt-model-pie-shell { grid-template-columns: 1fr; } .wt-model-pie { margin: auto; width: 132px; } }
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
    runtime.visibilityHandler = () => { if (document.visibilityState === 'visible' && runtime.state.fetchedAt && Date.now() - runtime.state.fetchedAt >= AUTO_REFRESH_INTERVAL_MS) refresh(); };
    document.addEventListener('visibilitychange', runtime.visibilityHandler);
    window.addEventListener('resize', applyPosition, { passive: true });
    const themeObserver = new MutationObserver(() => syncTheme());
    const themeAttributes = ['class', 'style', 'color-scheme', 'data-theme', 'data-color-scheme', 'theme'];
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: themeAttributes });
    if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: themeAttributes });
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
    clearTimeout(runtime.ui.tooltipTimer);
    cancelPositionFrame();
    runtime.ui.tooltipTimer = null;
    runtime.abortController?.abort();
    resetThreadUsageProbe();
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
