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
  function load() {
    const marker = '  window.wtChatgptAccountUsageCleanup = cleanup;\n  initialize();';
    assert.ok(source.includes(marker));
    const patched = source.replace(marker, `  return { runtime, deriveRanges, analyticsRequestRange, normalizeDailyRows, normalizeModelBreakdown, aggregateModelShares, modelBreakdownForRange, selectedAnalyticsRange, rebuildAnalyticsRanges, mergeCoverage, isRangeCovered, rangeError, fetchAnalyticsRange, fetchModelBreakdown, selectAnalyticsRange, commitAnalyticsRange, applyPosition, validateCustomRange, inclusiveRangeToExclusiveRange, setRequest(fn) { requestJSON = fn; } };`).replace('(() => {', 'return (() => {');
    const storage = new Map();
    const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
    const api = new Function('Date', 'URLSearchParams', 'localStorage', 'window', patched)(FixedDate, Params, localStorage, { innerWidth: 1440, innerHeight: 900 });
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
    api.runtime.host = { style: {}, getBoundingClientRect: () => ({ width: api.runtime.ui.wide ? 1120 : 400, height: 500 }) };
    api.applyPosition();
    assert.equal(api.runtime.host.style.right, '20px');
    assert.equal(api.runtime.host.style.bottom, '96px');
    api.runtime.ui.wide = true;
    api.applyPosition();
    assert.equal(api.runtime.host.style.left, '160px');
    assert.equal(api.runtime.host.style.top, '12px');
    assert.equal(api.runtime.host.style.right, 'auto');
    api.runtime.ui.wide = false;
    api.applyPosition();
    assert.equal(api.runtime.host.style.right, '20px');
    assert.equal(api.runtime.host.style.bottom, '96px');
    assert.equal(api.runtime.prefs.position, anchor);
  });
}

const source = readFileSync(join(__dirname, 'account-usage-dashboard.user.js'), 'utf8');
test('account usage dashboard range and layout regression', async (t) => {
  await runRegressionTests(source, assert, URLSearchParams, (name, fn) => t.test(name, fn));
});
