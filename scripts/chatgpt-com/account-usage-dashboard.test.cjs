'use strict';

// Dependency-free regression tests. The userscript is evaluated with initialization
// disabled in an isolated fixture; no authenticated requests or browser DOM are used.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

async function runRegressionTests(source, assert, Params, test) {
  const now = Date.parse('2026-11-23T12:00:00Z');
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const windowFixture = { scope: 'primary', label: '2 days', durationSeconds: 172800, resetAt: Date.parse('2026-11-24T00:00:00Z'), usedPercent: 40 };
  const fixtureDays = ['2026-10-29', '2026-11-02', '2026-11-18', '2026-11-22', '2026-11-23'];
  const daily = fixtureDays.map((date, i) => {
    const tokens = 100 * 2 ** i;
    return { date, totals: { tokens, turns: i + 1, threads: 1 }, clients: [{ client_id: i < 2 ? 'CLI' : 'WEB', totals: { tokens, turns: i + 1, threads: 1 } }] };
  });
  const models = { units: 'percent', data: fixtureDays.map((date, i) => ({ date, models: [{ model: i < 2 ? 'model-a' : 'model-b', speed: 'standard', credits: 100 }] })) };
  function load(storage = new Map()) {
    const marker = '  window.wtChatgptAccountUsageCleanup = cleanup;\n  initialize();';
    assert.ok(source.includes(marker));
    const patched = source.replace(marker, `  return { runtime, deriveRanges, analyticsRequestRange, normalizeDailyRows, normalizeModelBreakdown, aggregateModelShares, modelBreakdownForRange, selectedAnalyticsRange, rebuildAnalyticsRanges, mergeCoverage, isRangeCovered, rangeError, fetchAnalyticsRange, fetchModelBreakdown, selectAnalyticsRange, commitAnalyticsRange, applyPosition, validateCustomRange, inclusiveRangeToExclusiveRange, estimateApiCost, estimateDailyApiEquivalent, estimateRangeApiEquivalent, reconcileClientTotals, renderRangeAnalysis, isWidePanel, setWidePreference, startDrag, setRequest(fn) { requestJSON = fn; } };`).replace('(() => {', 'return (() => {');
    const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
    const document = { createElement(tag) {
      return { tag, className: '', textContent: '', dataset: {}, children: [], append(...children) { this.children.push(...children); } };
    } };
    const api = new Function('Date', 'URLSearchParams', 'localStorage', 'window', 'document', patched)(FixedDate, Params, localStorage, { innerWidth: 1440, innerHeight: 900 }, document);
    api.runtime.state.data = { windows: [windowFixture] };
    api.rebuildAnalyticsRanges();
    return api;
  }
  const ok = (data) => ({ ok: true, status: 200, data });
  const fail = { ok: false, status: 403, data: null };
  function mock(api, calls) {
    api.setRequest(async (url) => {
      calls.push(url);
      return ok(url.includes('daily-token-usage-breakdown') ? models : daily);
    });
  }
  async function populate(api) {
    const calls = [];
    mock(api, calls);
    const { start, end } = api.analyticsRequestRange([windowFixture]);
    await Promise.all([api.fetchAnalyticsRange(start, end), api.fetchModelBreakdown(start, end)]);
    return calls;
  }

  await test('UTC bounds and distinct preset aggregates including repeated 100% daily rows', async () => {
    const api = load();
    const calls = await populate(api);
    assert.equal(calls.length, 2);
    assert.ok(calls.some((url) => url.includes('daily-workspace-usage-counts?start_date=2026-10-25&end_date=2026-11-24')));
    assert.ok(calls.some((url) => url.includes('daily-token-usage-breakdown?start_date=2026-10-25&end_date=2026-11-23')));
    for (const [id, tokens, days, dominant, clients] of [
      ['cycle', 2400, 2, 'model-b', ['WEB']],
      ['7d', 2800, 3, 'model-b', ['WEB']],
      ['month', 3000, 4, 'model-b', ['WEB', 'CLI']],
      ['30d', 3100, 5, 'model-b', ['WEB', 'CLI']]
    ]) {
      await api.selectAnalyticsRange(id);
      const range = api.selectedAnalyticsRange();
      assert.equal(range.stats.tokens, tokens);
      assert.equal(range.stats.rows.length, days);
      assert.equal(api.runtime.state.modelBreakdown.rows[0].model, dominant);
      assert.deepEqual(api.runtime.state.analytics.clientRows.map((row) => row.clientId), clients);
      assert.equal(api.modelBreakdownForRange(range).dailyRows.length, days);
      assert.equal(api.modelBreakdownForRange(api.runtime.state.analytics.ranges.cycle).dailyRows.length, 2);
      assert.ok(Math.abs(api.runtime.state.modelBreakdown.rows.reduce((sum, row) => sum + row.sharePercent, 0) - 100) < 1e-9);
    }
    assert.equal(api.runtime.state.modelBreakdown.rows[0].sharePercent, 60);
    assert.equal(calls.length, 2);
  });

  await test('custom dates are inclusive, draft does not commit, cached custom range updates every aggregate', async () => {
    const api = load();
    const calls = await populate(api);
    api.selectAnalyticsRange('custom');
    assert.equal(api.runtime.prefs.range, 'cycle');
    assert.ok(api.runtime.ui.customRangeEditor);
    assert.equal(api.validateCustomRange('2026-10-29', '2026-10-29'), null);
    assert.ok(api.validateCustomRange('2026-11-24', '2026-11-24'));
    assert.ok(api.validateCustomRange('2024-01-01', '2026-01-01'));
    assert.deepEqual(api.inclusiveRangeToExclusiveRange('2026-10-29', '2026-10-29'), { start: '2026-10-29', end: '2026-10-30' });
    api.runtime.prefs.customStart = '2026-10-29';
    api.runtime.prefs.customEnd = '2026-10-29';
    await api.commitAnalyticsRange('custom');
    assert.equal(api.selectedAnalyticsRange().stats.tokens, 100);
    assert.equal(api.runtime.state.modelBreakdown.rows[0].model, 'model-a');
    assert.equal(api.runtime.state.analytics.clientRows[0].clientId, 'CLI');
    assert.equal(api.runtime.state.analytics.ranges.cycle.stats.tokens, 2400);
    assert.equal(calls.length, 2);
  });

  await test('uncovered custom range and rapid switches never publish old range as the selected range', async () => {
    const api = load();
    await populate(api);
    const pending = [];
    api.setRequest((url) => new Promise((resolve) => pending.push({ url, resolve })));
    api.runtime.prefs.customStart = '2026-10-01';
    api.runtime.prefs.customEnd = '2026-10-01';
    const request = api.commitAnalyticsRange('custom');
    assert.equal(api.runtime.prefs.range, 'custom');
    assert.equal(api.runtime.state.analytics.clientRows.length, 0);
    assert.equal(api.runtime.state.modelBreakdown.rows.length, 0);
    assert.equal(pending.length, 2);
    api.runtime.prefs.customStart = '2026-10-02';
    api.runtime.prefs.customEnd = '2026-10-02';
    const obsolete = api.commitAnalyticsRange('custom');
    const recent = api.selectAnalyticsRange('7d');
    for (const entry of pending) {
      assert.ok(entry.url.includes('start_date=2026-10-01'));
      entry.resolve(ok(entry.url.includes('daily-token-usage-breakdown')
        ? { units: 'percent', data: [{ date: '2026-10-01', models: [{ model: 'old', speed: 'standard', credits: 100 }] }] }
        : [{ date: '2026-10-01', totals: { tokens: 9999 } }]));
    }
    await Promise.all([request, obsolete, recent]);
    assert.equal(pending.length, 2);
    assert.equal(api.runtime.prefs.range, '7d');
    assert.equal(api.selectedAnalyticsRange().stats.tokens, 2800);
    assert.equal(api.runtime.state.modelBreakdown.rows[0].model, 'model-b');
    assert.equal(api.runtime.state.analytics.ranges.cycle.stats.tokens, 2400);
  });

  await test('forced refresh bypasses coverage, removes missing dates and isolates errors by range', async () => {
    const api = load();
    await populate(api);
    const range = api.runtime.state.analytics.ranges['30d'];
    const calls = [];
    api.setRequest(async (url) => { calls.push(url); return fail; });
    await Promise.all([api.fetchAnalyticsRange(range.start, range.end, {}, true), api.fetchModelBreakdown(range.start, range.end, {}, true)]);
    assert.equal(calls.length, 2);
    assert.ok(api.rangeError(api.runtime.state.analytics, range));
    assert.ok(api.modelBreakdownForRange(range).stale);
    assert.equal(api.modelBreakdownForRange(range).rows.length, 2);
    api.setRequest(async (url) => ok(url.includes('daily-token-usage-breakdown') ? { units: 'percent', data: [] } : []));
    await Promise.all([api.fetchAnalyticsRange('2026-10-01', '2026-10-02', {}, true), api.fetchModelBreakdown('2026-10-01', '2026-10-02', {}, true)]);
    assert.ok(api.rangeError(api.runtime.state.analytics, range));
    assert.ok(api.modelBreakdownForRange(range).stale);
    await Promise.all([api.fetchAnalyticsRange(range.start, range.end, {}, true), api.fetchModelBreakdown(range.start, range.end, {}, true)]);
    assert.equal(api.rangeError(api.runtime.state.analytics, range), null);
    assert.equal(api.modelBreakdownForRange(range).error, null);
    assert.equal(api.modelBreakdownForRange(range).covered, true);
    assert.equal(api.modelBreakdownForRange(range).rows.length, 0);
    assert.equal(api.runtime.state.analytics.dailyRows.length, 0);
  });

  await test('independent source failures and invalid dates or units do not create misleading rows', async () => {
    const api = load();
    api.setRequest(async (url) => url.includes('daily-token-usage-breakdown') ? ok({ units: 'tokens', data: models.data }) : ok(daily));
    const range = api.runtime.state.analytics.ranges['30d'];
    assert.deepEqual(await Promise.all([api.fetchAnalyticsRange(range.start, range.end), api.fetchModelBreakdown(range.start, range.end)]), [true, false]);
    assert.equal(api.runtime.state.analytics.clientRows.length, 1);
    assert.ok(api.modelBreakdownForRange(range).error);
    assert.equal(api.modelBreakdownForRange(range).rows.length, 0);
    assert.equal(api.normalizeDailyRows([{ totals: { tokens: 999 } }, { date: '2026-02-30', totals: { tokens: 999 } }]).length, 0);
    assert.equal(api.normalizeModelBreakdown({ units: 'percent', data: [{ models: [{ model: 'invalid', credits: 100 }] }] }).dailyRows.length, 0);
    assert.equal(api.normalizeModelBreakdown({ units: 'percent' }).supported, false);
  });

  await test('wide and compact positions preserve the original anchor', () => {
    const api = load();
    const anchor = { version: 2, horizontal: 'right', vertical: 'bottom', offsetX: 20, offsetY: 96 };
    api.runtime.prefs.position = anchor;
    api.runtime.prefs.collapsed = false;
    api.runtime.host = { style: {}, getBoundingClientRect: () => ({ width: api.runtime.prefs.wide ? 1120 : 400, height: 500 }) };
    api.applyPosition();
    assert.equal(api.runtime.host.style.right, '20px');
    assert.equal(api.runtime.host.style.bottom, '96px');
    api.setWidePreference(true);
    api.applyPosition();
    assert.equal(api.runtime.host.style.left, '160px');
    assert.equal(api.runtime.host.style.top, '12px');
    assert.equal(api.runtime.host.style.right, 'auto');
    api.setWidePreference(false);
    api.applyPosition();
    assert.equal(api.runtime.host.style.right, '20px');
    assert.equal(api.runtime.host.style.bottom, '96px');
    assert.equal(api.runtime.prefs.position, anchor);
  });

  await test('remembered wide preference survives collapse and reload without disabling launcher click or drag', () => {
    const storage = new Map();
    const api = load(storage);
    assert.equal(api.runtime.prefs.wide, false);
    api.runtime.prefs.collapsed = false;
    api.setWidePreference(true);
    assert.equal(api.isWidePanel(), true);
    api.runtime.prefs.collapsed = true;
    assert.equal(api.isWidePanel(), false);
    assert.equal(api.runtime.prefs.wide, true);
    const next = load(storage);
    assert.equal(next.runtime.prefs.wide, true);
    assert.equal(next.isWidePanel(), false);
    const rect = { width: 46, height: 46, left: 100, right: 146, top: 100, bottom: 146 };
    next.runtime.host = { style: {}, getBoundingClientRect: () => rect };
    const listeners = new Map();
    const launcher = {
      classList: { contains: (name) => name === 'wt-launcher' },
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name) { listeners.delete(name); }
    };
    const event = { button: 0, clientX: 120, clientY: 120, pointerId: 1, target: launcher };
    next.startDrag(event, launcher);
    assert.ok(listeners.has('pointermove'));
    listeners.get('pointerup')({ type: 'pointerup', pointerId: 1 });
    assert.equal(next.runtime.prefs.collapsed, false);
    assert.equal(next.isWidePanel(), true);
    next.setWidePreference(false);
    assert.equal(load(storage).runtime.prefs.wide, false);
    storage.set('wt-chatgpt-account-usage:wide', '"invalid"');
    assert.equal(load(storage).runtime.prefs.wide, false);
  });

  await test('standard text prices apply independently to token classes and daily model weights', () => {
    const api = load();
    const metrics = { tokens: 3_000_000, uncachedInputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 };
    const rows = [{ model: 'gpt-6.2-sol', sharePercent: 75 }, { model: 'gpt-6.2-astra', sharePercent: 25 }];
    const complete = (rows) => ({ rows, complete: true });
    const result = api.estimateDailyApiEquivalent(metrics, complete(rows));
    assert.ok(Math.abs(result.valueUsd - (12.1 * .75 + 48.4 * .25)) < 1e-9);
    assert.equal(result.modelCosts.length, 2);
    assert.equal(api.estimateApiCost({ model: 'gpt-5.6', inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 }).valueUsd, 4);
    assert.equal(api.estimateApiCost({ model: 'gpt-6.1-terra', inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 }).valueUsd, .05);
    assert.equal(api.estimateApiCost({ model: 'gpt-6-luna', inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 }).valueUsd, .01);
    assert.equal(api.estimateDailyApiEquivalent({ ...metrics, cachedInputTokens: null }, complete(rows)).valueUsd, null);
    assert.equal(api.estimateDailyApiEquivalent({ ...metrics, tokens: 4_000_000 }, complete(rows)).valueUsd, null);
    assert.equal(api.estimateDailyApiEquivalent(metrics, complete([{ ...rows[0] }, { model: 'unknown-model', sharePercent: 25 }])).valueUsd, null);
    assert.equal(api.estimateDailyApiEquivalent(metrics, complete([])).valueUsd, null);
    assert.equal(api.estimateDailyApiEquivalent(metrics, complete([{ model: 'constructor', sharePercent: 100 }])).valueUsd, null);
    const zero = { tokens: 0, uncachedInputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    assert.equal(api.estimateDailyApiEquivalent(zero, complete(rows)).valueUsd, 0);
  });

  await test('range analysis uses selected dates, calculates daily before summing, and marks incomplete or stale estimates', async () => {
    const api = load();
    const ws = [
      { date: '2026-10-29', totals: { tokens: 1_000_000, uncached_input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0, credits: 12 } },
      { date: '2026-11-18', totals: { tokens: 1_000_000, uncached_input_tokens: 0, cached_input_tokens: 1_000_000, output_tokens: 0 } },
      { date: '2026-11-22', totals: { tokens: 2_000_000, uncached_input_tokens: 0, cached_input_tokens: 0, output_tokens: 2_000_000, credits: 20 } },
      { date: '2026-11-23', totals: { tokens: 1_000_000, uncached_input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0 } }
    ];
    const breakdown = { units: 'percent', data: [
      { date: '2026-10-29', models: [{ model: 'gpt-5.6-sol', credits: 100 }] },
      { date: '2026-11-18', models: [{ model: 'gpt-6.2-sol', credits: 100 }] },
      { date: '2026-11-22', models: [{ model: 'gpt-6.2-astra', credits: 100 }] },
      { date: '2026-11-23', models: [{ model: 'unknown-model', credits: 100 }] }
    ] };
    api.setRequest(async (url) => ok(url.includes('daily-token-usage-breakdown') ? breakdown : ws));
    const { start, end } = api.analyticsRequestRange([windowFixture]);
    await Promise.all([api.fetchAnalyticsRange(start, end), api.fetchModelBreakdown(start, end)]);
    let estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.valueUsd, 80);
    assert.equal(estimate.pricedDays, 1);
    assert.equal(estimate.returnedDays, 2);
    assert.equal(estimate.days.get('2026-11-23').valueUsd, null);
    const collect = (node) => [node.textContent, ...node.children.flatMap(collect)].join(' ');
    assert.ok(collect(api.renderRangeAnalysis()).includes('实际额度窗口 Credits 推算'));
    await api.selectAnalyticsRange('7d');
    estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.ok(Math.abs(estimate.valueUsd - 80.1) < 1e-9);
    assert.equal(estimate.pricedDays, 2);
    assert.equal(estimate.calendarDays, 7);
    let rendered = collect(api.renderRangeAnalysis());
    assert.ok(rendered.includes('2026-11-18'));
    assert.ok(!rendered.includes('2026-10-29'));
    assert.ok(!rendered.includes('实际额度窗口 Credits 推算'));
    assert.ok(rendered.includes('仅为可估算日期小计'));
    assert.ok(rendered.includes('未估算原因'));
    await api.selectAnalyticsRange('30d');
    estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.ok(Math.abs(estimate.valueUsd - 84.1) < 1e-9);
    assert.equal(estimate.pricedDays, 3);
    assert.ok(collect(api.renderRangeAnalysis()).includes('2026-10-29'));
    api.runtime.prefs.customStart = '2026-10-29';
    api.runtime.prefs.customEnd = '2026-10-29';
    await api.commitAnalyticsRange('custom');
    estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.valueUsd, 4);
    assert.equal(estimate.calendarDays, 1);
    assert.equal(estimate.pricedDays, 1);
    assert.ok(!collect(api.renderRangeAnalysis()).includes('实际额度窗口 Credits 推算'));
    api.setRequest(async () => fail);
    await api.fetchModelBreakdown('2026-10-29', '2026-10-30', {}, true);
    estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.stale, true);
    assert.equal(estimate.valueUsd, 4);
    const fresh = load();
    assert.equal(fresh.estimateRangeApiEquivalent(fresh.selectedAnalyticsRange()).valueUsd, null);
  });

  await test('normalization retains incomplete daily model distributions rather than pricing survivors', () => {
    const api = load();
    const metrics = { tokens: 1_000_000, uncachedInputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 };
    const valid = { model: 'gpt-6.2-sol', credits: 50 };
    for (const malformed of [
      { credits: 50 }, { model: ' ', credits: 50 }, { model: 123, credits: 50 },
      { model: 'gpt-6.2-astra' }, { model: 'gpt-6.2-astra', credits: null },
      { model: 'gpt-6.2-astra', credits: 'invalid' }, { model: 'gpt-6.2-astra', credits: ' ' },
      { model: 'gpt-6.2-astra', credits: -1 }, { model: 'gpt-6.2-astra', credits: 101 },
      { model: 'gpt-6.2-astra', credits: [] }, { model: 'gpt-6.2-astra', credits: true }, null
    ]) {
      const normalized = api.normalizeModelBreakdown({ units: 'percent', data: [{ date: '2026-11-23', models: [valid, malformed] }] });
      assert.equal(normalized.dailyRows.length, 1);
      const day = normalized.dailyRows[0];
      assert.equal(day.complete, false);
      assert.equal(day.rows.length, 1);
      assert.equal(normalized.rows.length, 0);
      const estimate = api.estimateDailyApiEquivalent(metrics, day);
      assert.equal(estimate.valueUsd, null);
      assert.ok(estimate.reason.includes('模型分布不完整'));
    }
    const allInvalid = api.normalizeModelBreakdown({ units: 'percent', data: [{ date: '2026-11-23', models: [{ credits: 50 }] }] });
    assert.equal(allInvalid.dailyRows.length, 1);
    assert.equal(allInvalid.dailyRows[0].complete, false);
    assert.equal(allInvalid.dailyRows[0].rows.length, 0);

    // Rows for the same date may arrive in separate flat or nested buckets.
    const split = api.normalizeModelBreakdown({ units: 'percent', data: [
      { date: '2026-11-23', ...valid },
      { date: '2026-11-23', credits: 50 },
      { date: '2026-11-22', models: [valid] },
      { date: '2026-11-22', models: { credits: 50 } }
    ] });
    assert.equal(split.dailyRows.length, 2);
    assert.ok(split.dailyRows.every((day) => day.complete === false));

    // Preserve existing weight semantics: returned per-day weights are not
    // required to sum to 100; a known zero may be ignored safely.
    const complete = api.normalizeModelBreakdown({ units: 'percent', data: [
      { date: '2026-11-23', models: [valid, { model: 'gpt-6.2-astra', credits: '25' }, { credits: 0 }] }
    ] });
    assert.equal(complete.dailyRows[0].complete, true);
    assert.equal(complete.dailyRows[0].rows.length, 2);
    assert.ok(Math.abs(api.estimateDailyApiEquivalent(metrics, complete.dailyRows[0]).valueUsd - 4) < 1e-9);
    const unknownPrice = api.normalizeModelBreakdown({ units: 'percent', data: [
      { date: '2026-11-23', models: [valid, { model: 'unknown-model', credits: 50 }] }
    ] });
    assert.equal(unknownPrice.dailyRows[0].complete, true);
    assert.equal(api.estimateDailyApiEquivalent(metrics, unknownPrice.dailyRows[0]).valueUsd, null);
  });

  await test('incomplete distributions remain excluded through fetch, range cache and rendering; valid refresh repairs the day', async () => {
    const api = load();
    const totals = { tokens: 1_000_000, uncached_input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0 };
    const ws = ['2026-11-21', '2026-11-22', '2026-11-23'].map((date) => ({ date, totals }));
    let payload = { units: 'percent', data: [
      { date: '2026-11-21', models: [{ model: 'gpt-6.2-astra', credits: 100 }] },
      { date: '2026-11-22', models: [{ model: 'gpt-6.2-sol', credits: 50 }, { credits: 50 }] },
      { date: '2026-11-23', models: [{ credits: 100 }] }
    ] };
    api.setRequest(async (url) => ok(url.includes('daily-token-usage-breakdown') ? payload : ws));
    const { start, end } = api.analyticsRequestRange([windowFixture]);
    await Promise.all([api.fetchAnalyticsRange(start, end), api.fetchModelBreakdown(start, end)]);
    let estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.pricedDays, 0);
    assert.equal(estimate.returnedDays, 2);
    assert.equal(estimate.valueUsd, null);
    assert.ok(estimate.days.get('2026-11-22').reason.includes('模型分布不完整'));
    assert.ok(estimate.days.get('2026-11-23').reason.includes('模型分布不完整'));
    await api.selectAnalyticsRange('7d');
    estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.pricedDays, 1);
    assert.equal(estimate.returnedDays, 3);
    assert.equal(estimate.valueUsd, 8);
    assert.deepEqual(estimate.modelCosts, [{ model: 'gpt-6.2-astra', valueUsd: 8 }]);
    assert.deepEqual(api.runtime.state.modelBreakdown.rows.map((row) => row.model), ['gpt-6.2-astra']);
    const collect = (node) => [node.textContent, ...node.children.flatMap(collect)].join(' ');
    const rendered = collect(api.renderRangeAnalysis());
    assert.ok(rendered.includes('模型分布不完整'));
    assert.ok(rendered.includes('仅为可估算日期小计'));
    assert.ok(rendered.includes('不参与区间占比或占比分摊'));
    await api.selectAnalyticsRange('cycle');
    payload = { units: 'percent', data: [
      { date: '2026-11-22', models: [{ model: 'gpt-6.2-sol', credits: 50 }, { model: 'gpt-6.2-astra', credits: 50 }] },
      { date: '2026-11-23', models: [{ model: 'gpt-6.2-sol', credits: 100 }] }
    ] };
    await api.fetchModelBreakdown('2026-11-22', '2026-11-24', {}, true);
    estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.pricedDays, 2);
    assert.equal(estimate.valueUsd, 7);
    assert.equal(estimate.days.get('2026-11-22').reason, null);
    assert.ok(api.modelBreakdownForRange(api.selectedAnalyticsRange()).dailyRows.every((day) => day.complete));
    assert.ok(!collect(api.renderRangeAnalysis()).includes('模型分布不完整'));
  });

  await test('reconciled model-level absolute tokens take precedence over model shares without double-counting', async () => {
    const api = load();
    const totals = { text_total_tokens: 3_000_000, uncached_text_input_tokens: 1_000_000, cached_text_input_tokens: 1_000_000, text_output_tokens: 1_000_000 };
    const raw = { date: '2026-11-23', totals, models: [
      { model: 'gpt-6.2-sol', uncached_text_input_tokens: 1_000_000, cached_text_input_tokens: 1_000_000, text_output_tokens: 0 },
      { model: 'gpt-6.2-astra', totals: { uncached_text_input_tokens: 0, cached_text_input_tokens: 0, text_output_tokens: 1_000_000 } }
    ] };
    const share = { units: 'percent', data: [{ date: raw.date, models: [{ model: 'gpt-6.2-sol', credits: 100 }] }] };
    const distribution = api.normalizeModelBreakdown(share).dailyRows[0];
    const day = api.normalizeDailyRows([raw])[0];
    const actual = api.estimateDailyApiEquivalent(day.metrics, distribution, day.absoluteModels);
    assert.equal(actual.method, 'model-tokens');
    assert.ok(Math.abs(actual.valueUsd - 42.1) < 1e-9);
    assert.equal(actual.allocations[1].outputTokens, 1_000_000);
    assert.equal(actual.allocations[1].pricing.outputPerMillion, 40);
    const fallback = api.estimateDailyApiEquivalent(day.metrics, distribution);
    assert.equal(fallback.method, 'model-share');
    assert.ok(Math.abs(fallback.valueUsd - 12.1) < 1e-9);
    for (const invalid of [
      [{ model: 'gpt-6.2-sol', uncached_text_input_tokens: 1_000_000, cached_text_input_tokens: 1_000_000 }],
      [{ model: 'gpt-6.2-sol', uncached_text_input_tokens: 0, cached_text_input_tokens: 2_000_000, text_output_tokens: 1_000_000 }],
      [{ model: 'gpt-6.2-sol', uncached_text_input_tokens: 1_000_000, cached_text_input_tokens: 1_000_000, text_output_tokens: 1_000_000, text_total_tokens: 'bad' }],
      [{ model: 'gpt-6.2-sol', uncached_text_input_tokens: 1_000_000, cached_text_input_tokens: 1_000_000, text_output_tokens: 1_000_000 }, null]
    ]) {
      const normalized = api.normalizeDailyRows([{ ...raw, models: invalid }])[0];
      const result = api.estimateDailyApiEquivalent(normalized.metrics, distribution, normalized.absoluteModels);
      assert.equal(result.method, 'model-share');
      assert.ok(result.fallbackReason);
      assert.ok(Math.abs(result.valueUsd - 12.1) < 1e-9);
    }
    const unknown = api.normalizeDailyRows([{ ...raw, models: [{ model: 'unknown-model', ...totals }] }])[0];
    const unknownResult = api.estimateDailyApiEquivalent(unknown.metrics, distribution, unknown.absoluteModels);
    assert.equal(unknownResult.method, 'model-tokens');
    assert.equal(unknownResult.valueUsd, null);
    assert.equal(unknownResult.allocations[0].pricing, null);

    api.setRequest(async (url) => url.includes('daily-token-usage-breakdown') ? fail : ok([raw]));
    const { start, end } = api.analyticsRequestRange([windowFixture]);
    await Promise.all([api.fetchAnalyticsRange(start, end), api.fetchModelBreakdown(start, end)]);
    const estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.modelCovered, false);
    assert.equal(estimate.measuredDays, 1);
    assert.equal(estimate.allocatedDays, 0);
    assert.equal(estimate.tokenCoveragePercent, 100);
    assert.ok(Math.abs(estimate.valueUsd - 42.1) < 1e-9);
    const collect = (node) => [node.textContent, ...node.children.flatMap(collect)].join(' ');
    const rendered = collect(api.renderRangeAnalysis());
    assert.ok(rendered.includes('逐类对账通过'));
    assert.ok(rendered.includes('Token 计价覆盖率：100%'));
  });

  await test('coverage weights returned token volumes rather than day count and audits daily allocations', async () => {
    const api = load();
    const ws = [
      { date: '2026-11-22', totals: { tokens: 1_000_000, uncached_input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0 } },
      { date: '2026-11-23', totals: { tokens: 9_000_000, uncached_input_tokens: 9_000_000, cached_input_tokens: 0, output_tokens: 0 } }
    ];
    const md = { units: 'percent', data: [
      { date: '2026-11-22', models: [{ model: 'gpt-6.2-sol', speed: 'standard', credits: 20 }, { model: 'gpt-6.2-astra', speed: 'fast', credits: 30 }] },
      { date: '2026-11-23', models: [{ model: 'unknown-model', credits: 100 }] }
    ] };
    api.setRequest(async (url) => ok(url.includes('daily-token-usage-breakdown') ? md : ws));
    const { start, end } = api.analyticsRequestRange([windowFixture]);
    await Promise.all([api.fetchAnalyticsRange(start, end), api.fetchModelBreakdown(start, end)]);
    let estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.pricedDays, 1);
    assert.equal(estimate.reportedTokens, 10_000_000);
    assert.equal(estimate.pricedTokens, 1_000_000);
    assert.equal(estimate.tokenCoveragePercent, 10);
    assert.equal(estimate.allocatedDays, 1);
    assert.ok(Math.abs(estimate.valueUsd - 5.6) < 1e-9);
    const allocations = estimate.days.get('2026-11-22').allocations;
    const sol = allocations.find((row) => row.model === 'gpt-6.2-sol');
    assert.equal(sol.rawShare, 20);
    assert.equal(sol.weight, .4);
    assert.equal(sol.uncachedInputTokens, 400_000);
    assert.equal(sol.valueUsd, .8);
    assert.equal(estimate.days.get('2026-11-23').allocations[0].valueUsd, null);
    const collect = (node) => [node.textContent, ...node.children.flatMap(collect)].join(' ');
    const rendered = collect(api.renderRangeAnalysis());
    assert.ok(rendered.includes('Token 计价覆盖率：10%'));
    assert.ok(rendered.includes('2026-11-22 · 计价明细'));
    assert.ok(rendered.includes('400,000'));
    assert.ok(rendered.includes('20%'));
    assert.ok(rendered.includes('40%'));
    assert.ok(rendered.includes('无已知 Standard 费率'));
    ws[1].totals = { uncached_input_tokens: 9_000_000 };
    await api.fetchAnalyticsRange(start, end, {}, true);
    estimate = api.estimateRangeApiEquivalent(api.selectedAnalyticsRange());
    assert.equal(estimate.unknownTokenDays, 1);
    assert.equal(estimate.tokenCoveragePercent, null);
    assert.equal(estimate.reportedTokens, 1_000_000);
  });

  await test('client shares reconcile against daily totals and never identify residual as Chat usage', () => {
    const api = load();
    const rows = api.normalizeDailyRows([
      { date: '2026-11-22', totals: { text_total_tokens: 100 }, clients: [{ client_id: 'CLI', text_total_tokens: 60 }, { client_id: 'WEB', text_total_tokens: 10 }] },
      { date: '2026-11-23', totals: { text_total_tokens: 200 }, clients: [{ client_id: 'CLI', text_total_tokens: 100 }] }
    ]);
    let result = api.reconcileClientTotals(rows, '2026-11-22', '2026-11-24');
    assert.equal(result.reportedTokens, 300);
    assert.equal(result.groupedTokens, 170);
    assert.equal(result.unclassifiedTokens, 130);
    assert.equal(result.rows.find((row) => row.unclassified).tokens, 130);
    assert.ok(Math.abs(result.rows.reduce((sum, row) => sum + row.tokenShare, 0) - 100) < 1e-9);
    rows[0].clients[0].metrics.tokens = 120;
    result = api.reconcileClientTotals(rows, '2026-11-22', '2026-11-24');
    assert.equal(result.excessDays, 1);
    assert.equal(result.unclassifiedTokens, 100);
    assert.ok(result.rows.every((row) => row.tokenShare === null));
    const malformed = api.normalizeDailyRows([{ date: '2026-11-23', totals: { tokens: 100 }, clients: [null, { client_id: 'CLI', tokens: 20 }] }]);
    result = api.reconcileClientTotals(malformed, '2026-11-23', '2026-11-24');
    assert.equal(result.unknownDays, 1);
    assert.equal(result.unclassifiedTokens, 0);
    assert.ok(result.rows.every((row) => row.tokenShare === null));
    const partial = api.normalizeDailyRows([{ date: '2026-11-23', totals: { cached_text_input_tokens: 100 } }]);
    assert.equal(partial[0].metrics.tokens, null);
  });
}

const source = readFileSync(join(__dirname, 'account-usage-dashboard.user.js'), 'utf8');
test('account usage dashboard range and layout regression', async (t) => {
  await runRegressionTests(source, assert, URLSearchParams, (name, fn) => t.test(name, fn));
});
