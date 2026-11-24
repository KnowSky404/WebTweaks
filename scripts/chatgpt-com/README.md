# ChatGPT Account Usage Dashboard

`account-usage-dashboard.user.js` adds a small floating usage icon to `chatgpt.com`. Click it to open the full, draggable account-usage panel. It is a standalone Tampermonkey/Violentmonkey userscript and does not require a build step, package manager, or remote dependency.

Version 1.8.0 remembers the last compact/wide panel layout and synchronizes Range Analysis with the selected UTC usage range, including daily detail, model usage and auditable Standard API-equivalent USD estimates that prefer reconciled model-level token data, otherwise use explicitly hypothetical share allocation. Actual quota windows remain independent, and authoritative cost data is still unavailable.

## Installation

Install Tampermonkey or Violentmonkey, then open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/chatgpt-com/account-usage-dashboard.user.js) and confirm installation. Open or reload a `https://chatgpt.com/` page while signed in.

## Data sources and fallback behavior

The script only makes same-origin, read-only requests to the current ChatGPT page:

- `/api/auth/session` supplies the display name, masked email, and narrowly selected in-memory authentication fallback fields.
- `/backend-api/wham/usage` supplies the plan, rate-limit windows, credits, and usage state.
- `/backend-api/wham/analytics/daily-workspace-usage-counts` supplies optional daily statistics for a requested date range, filtered and aggregated in memory for the displayed ranges.
- `daily-workspace-usage-counts[].totals.credits` is retained as an optional Codex Credit field. Missing or zero Credits remain unavailable rather than becoming a meaningful zero.
- `/backend-api/wham/usage/daily-token-usage-breakdown` is the Analytics data source for the model-usage breakdown. Its `credits` field is interpreted according to the response's `units: "percent"` declaration as a percentage/model-usage share, not as the dashboard's Credits field and not as a token percentage.

The usage request first uses cookie-only credentials. A 401/403 response may trigger a session lookup and one authenticated retry using an access token and account ID held only in memory; neither value is persisted or displayed. Analytics is optional: a 403, 404, timeout, empty response, or schema change leaves the account and quota sections available and marks only the analytics area as unavailable or partial. The normalizer understands primary/secondary windows inside `rate_limit`, arrays and maps under `rate_limits`, and wrapped `additional_rate_limits` entries. The model-breakdown endpoint is also optional and is treated as Analytics data; it is not a thread-level token ledger.

## Displayed fields

The compact view is only an icon with an optional health dot; it does not show the plan, percentages, or countdown. The expanded panel can show:

- signed-in state, display name, masked email, plan context (including `Pro Lite` as a plan tier), usage status, and update time;
- every recognized primary and additional rate-limit window, with duration, used/remaining percentages, progress, reset time, countdown, and limit state;
- optional Credits and spend-control fields only when the server supplies values, without treating missing or `null` values as zero;
- range analysis with Tokens, Turns, Threads, daily model usage and a hypothetical API-equivalent cost estimate, all following the selected range; optional real-Credit capacity extrapolation appears only for an actual current quota window derived from `reset_at - limit_window_seconds`;
- a daily breakdown with date, Tokens, Turns, Threads, primary model, and API-equivalent estimate when the required data is available; expand each date to inspect raw shares, calculation weights, three token classes, model identifiers, speed, price mapping, and cost;
- current quota period, month, last 7 days, and last 30 days, including server-supplied Credits, token classes, threads, turns, and dates with data;
- client aggregates sorted by tokens, reconciled against each day's total with a separate unclassified residual and discrepancy notice; a native CSS bar chart for the selected daily metric;
- a model-usage pie chart and daily model rows when the model-breakdown data is available: the same model and speed are merged, rows are sorted in descending share order, zero-valued rows are hidden, and the value is shown as a percentage/model-usage share. The field is never presented as `Credits`, `Token usage`, or a fabricated token count;
- a native conic-gradient model-usage pie chart with accessible legend tooltips, synchronized with the selected usage-statistics range;
- a title-bar expand/restore button for switching between compact and wide layouts without fetching data again;
- manual refresh;
- fixed five-minute automatic refresh;
- opening official Analytics in a new tab;
- collapsing the panel;
- safe diagnostics;
- a collapsed Data Sources diagnostic showing Workspace Analytics, Model Breakdown, Thread Usage, Credit, and `costCapability` availability without raw responses or credentials.

## UI design and product boundary

The launcher is a 44–48px draggable utility button with a generic usage/activity inline SVG, a subtle border and shadow, and a status indicator. A small pointer movement does not open the panel after a drag. The expanded panel uses the local `wt-` design tokens, a compact account summary, quota-window sections, analytics, title-bar icon actions, and collapsed diagnostics. It opens in the remembered layout (compact, approximately 400px wide, on first use), with an expand/restore icon in the top-right header. Wide mode is centered, up to 1120px wide with 12px viewport margins, and keeps scrolling inside the panel. On sufficiently wide screens, quota cards reflow into columns, Tokens/Turns/Threads use a three-column metric grid, model usage and client distribution sit side-by-side, and daily charts and tables have more space. Narrow viewports retain a single-column flow. Both layouts use the same data, range selection, theme, and section state.

The visual direction is a local adaptation of public [OpenAI Apps SDK UI](DESIGN.md#official-references) patterns. This is an unofficial userscript, not an OpenAI, ChatGPT, or Codex product. It does not use the OpenAI Logo, Blossom, wordmark, or other OpenAI marks; launcher icons are generic usage/activity symbols. See [`DESIGN.md`](DESIGN.md) for the complete site-level specification.

The launcher and compact panel share one size-independent viewport anchor. Dragging either updates that anchor; wide mode is centered and not draggable, and entering/leaving it never rewrites the compact anchor. Closing the panel, navigating or reloading the page retains the last explicitly chosen layout. The launcher remains compact and draggable even if wide mode is remembered. The layout preference and collapsed state are independent. Window-size changes may temporarily clamp the visible surface without overwriting the saved position.

## Model usage and cost contract

The model-usage breakdown belongs to Usage Statistics and comes from ChatGPT Analytics. A response with `units: "percent"` makes each model/speed value a usage percentage or model share. The source field is named `credits`, but the UI must not call it Credits, Token usage, or token percentage. Same-model/same-speed entries are merged per UTC date and then summed across the selected date buckets and normalized to 100% before descending sorting; zero values are omitted. The normalizer preserves an explicit per-day completeness flag before filtering zero or invalid entries. A missing/invalid share, missing model identity for a positive share, or malformed model entry invalidates that day's distribution. Known zero-share entries can be ignored. The interval pie excludes incomplete dates and displays a warning; daily details may still show recognized rows with an incomplete-data notice. Without authoritative per-day weights the pie is a normalized summary of the valid daily model values, not a token-weighted or independently verified account-wide consumption percentage. The distribution UI never presents model share as a token count; the separate API-equivalent scenario below uses it only as an explicitly hypothetical allocation weight.

### API-equivalent scenario (USD)

This is a Standard API-equivalent calculation, **not a ChatGPT/Codex bill, purchased Credits, or an estimate of remaining quota**. For each UTC date, prefer absolute per-model counts if Workspace Analytics supplies a `models` array with recognized model identities and all three token classes (uncached input, cached input, output). Each model's total must be consistent and each of the three per-model sums must match the corresponding daily total exactly. Price those counts directly; the percentage endpoint is not needed for that day. The presence of `models`, a model name, or a credit percentage alone does not prove model-level token attribution.

When the absolute model detail is absent, incomplete or does not reconcile, fall back to that date's valid Model Breakdown shares. Assume the three token classes have the same model distribution, normalize that day's returned weights, and calculate each model's hypothetical cost as:

`weight × (uncached_input × input_rate + cached_input × cached_rate + output × output_rate) / 1,000,000`

Sum the daily model contributions across the committed range, rather than applying the period's unweighted aggregate pie chart to total tokens. Do not interpret the model percentages as actual token shares. Model/speed rows remain separate in the distribution; the cost scenario uses the same Standard model rate for all speed values.

The following **USD per million text tokens** rates are a local Standard short-context reference snapshot checked **2026-11-23**, from [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing) and the [official model catalog](https://developers.openai.com/api/docs/models). Individual legacy rates were verified against the model pages for [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), and [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol). The pricing page notes GPT-5.6 Sol promotional pricing through 2026-11-30; this dated snapshot must be rechecked when prices change.

| API model ID | Uncached input | Cached input | Output |
| --- | ---: | ---: | ---: |
| `gpt-6.2-astra` | $8 | $0.40 | $40 |
| `gpt-6.2-sol` | $2 | $0.10 | $10 |
| `gpt-6-astra` | $10 | $1 | $50 |
| `gpt-6.1-sol` | $2 | $0.10 | $10 |
| `gpt-6.1-terra` | $1 | $0.05 | $5 |
| `gpt-6-sol` | $2 | $0.20 | $10 |
| `gpt-6-luna` | $0.10 | $0.01 | $0.50 |
| `gpt-5.6-sol` | $4 | $0.40 | $20 |
| `gpt-5.6-terra` | $2 | $0.20 | $12 |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 |
| `gpt-5.5` | $5 | $0.50 | $30 |
| `gpt-5.4` | $2.50 | $0.25 | $15 |

The snapshot reprices historical usage at these reference rates; it is not historical billing. Fast, long-context surcharges, cache writes, tools, discounts, taxes, regional surcharges and other fees are not modeled. Only documented model aliases/snapshots are mapped; unknown names are never assigned a guessed tier.

Workspace Analytics must cover the selected interval; Model Breakdown coverage is required only for share-based allocation. Days missing a token class, valid daily total, complete model distribution for fallback, or a rate for any participating model are excluded, not priced as zero or redistributed to known models. A reconciled absolute-model day with an unknown price is not silently replaced by a percentage-based estimate. Completeness is checked before allocation; a malformed share entry invalidates that day's share-based estimate, with an explicit unavailable reason. Per-day weights need not sum to exactly 100 because the source's denominator is not independently verified. All-invalid dates remain represented as incomplete. A subsequent successful refresh can replace the distribution. A successful empty response does not establish zero usage.

The UI labels partial results as a subtotal and shows priced/returned/calendar date counts, token-volume coverage (priced tokens divided by the known returned daily totals; unavailable when any returned total is unknown or the denominator is zero), separate reconciled-model and hypothetical-allocation token/day counts, and stale-data notices. Expand each date to inspect raw shares versus normalized weights, allocated or observed token classes, model/speed, exact pricing ID and per-million rates, individual USD estimates, and exclusion reasons. Model-level absolute token counts, where present and reconciled, are returned data; share allocation remains hypothetical even with 100% token coverage. No coverage metric proves the endpoint includes every account activity.

### Analytics scope and client reconciliation

The private Workspace Analytics endpoint is not a documented, complete account or Platform API billing ledger. A returned client ID describes a client, not necessarily a product/surface: Web or Desktop cannot by itself distinguish ordinary Chat, Work, and Codex. Compare each day's absolute total with the sum of client rows, report positive differences as unclassified, and suppress range percentages when any daily group exceeds the total or any required count is missing. Unclassified differences are **not** inferred Chat usage. Missing token classes cannot be used to derive a complete total. OpenAI's [shared ChatGPT/Codex allowance announcement](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits) describes a December 2026 transition and excludes Instant chat from that shared allowance; this policy alone does not establish what these private endpoints currently return. Verify product coverage in a signed-in account with controlled usage and allow for reporting delays.

### Open-source implementation references

- [ccusage Codex adapter](https://github.com/ccusage/ccusage/tree/main/rust/adapters/codex): calculates from local session model/token records, distinguishes cached and uncached input, and supports separate pricing tiers. Local logs are not an account-wide ledger.
- [CodexBar pricing design](https://github.com/steipete/CodexBar/blob/main/docs/model-pricing.md): exact provider/model pricing, explicit aliases, versioned rates and unknown-price handling.
- [codex-meter usage domain](https://github.com/Wangnov/codex-meter/blob/main/codex-meter-extension/domain/usage-domain.js): same private analytics data family, client residual reconciliation and optional absolute model token rows. Its Credit calculations are not substituted for this script's Standard API price table.

These references inform the data handling and audit design; no third-party runtime dependency or source-code import is required. The optional model schema and product scope still require live account verification.

## Cost capability boundary

The existing `usageCostProviders` seam retains `threadUsageProvider`, `creditProvider`, and `tokenPricingProvider` for distinct sources. The API-equivalent estimate (reconciled model tokens or model-share scenario) is deliberately calculated separately and cannot become a real Credit or billing estimate through the cost resolver. Version 1.8.0 does not probe Thread Usage during ordinary refresh. Diagnostics retain `costCapability: unavailable` for authoritative cost and report a separate reconciled-model/share-allocation capability label without any USD amounts. Actual quota percentages and Credits remain independent of this scenario.

## Safe diagnostics

Diagnostics may expose only redacted state useful for troubleshooting: source availability, model-breakdown status, model-row count, request status, and safe window-shape metadata. They must never expose Token values, cookies, authorization values, account IDs, thread IDs, raw responses, USD values, or other authentication material. No raw responses or authentication material may appear in the UI, console, clipboard, or persistent storage. The ordinary analytics UI may show the requested token metrics and the explicitly labeled hypothetical USD estimate; diagnostics, console, clipboard, and persistent storage must not contain these values.

## Plan labels and quota semantics

The display mapping keeps product labels readable without treating a plan label as a quota calculator:

| Server plan type | Display label |
| --- | --- |
| `prolite` | Pro Lite（Pro 5X） |
| `pro` | Pro（Pro 20X） |
| `plus` | Plus |
| `free` | Free |

`5X` and `20X` are tier descriptions only. They do not calculate absolute messages, override server values, prove billing or renewal status, or provide a hardcoded price. The current allowance, percentage, reset time, and limit state remain authoritative only when supplied by the server's quota window. Unknown future plan types are rendered as readable fallback text rather than silently assigned a known tier.

## Analytics ranges and privacy boundary

Analytics supports the current cycle, current month, last 7 days, last 30 days, and a custom range. The 7-day range means today plus the previous 6 UTC calendar days; the 30-day range means today plus the previous 29 UTC calendar days. Each range therefore contains at most 7 or 30 UTC date buckets, respectively. Each daily trend bar is the actual aggregate returned for one UTC date bucket by ChatGPT Analytics; the data may be delayed and is not a real-time streaming counter. Hover, keyboard focus, or touch reveals the date, metric, and unestimated value. Missing dates are not inserted as zeroes.

Custom dates use UTC date buckets and an inclusive UI end date: `2026-08-01 — 2026-08-14` includes August 14. The internal range converts that end date to the next UTC date for exclusive filtering. The Workspace Analytics request uses the exclusive end, while the model-breakdown request preserves its existing inclusive `end_date` convention. A custom range must be valid, must not end in the future, and is limited to a maximum of 366 days as a project-side defensive limit, not an OpenAI API limit.

Preset ranges share a contiguous daily-data request per source covering the current quota cycle, current month, and last 30 days. Changing to a covered range uses the cached rows for both sources; an uncovered custom range requests its exact dates separately. Applying a valid custom range commits the selection synchronously, and late responses update only date-scoped caches. Canceling a draft leaves the committed range unchanged. Range Analysis, its daily table, daily model rows, and the API-equivalent scenario follow the committed Usage Statistics interval. Actual quota-window reset times, percentages and real-Credit capacity extrapolation remain tied to the real quota window; the latter is displayed only when the current-cycle range is selected and relevant Credit data exists. Where no valid quota window is available, the existing 30-day fallback is explicitly labeled.

Manual and scheduled refreshes bypass coverage caches and replace rows inside the requested interval, including successful empty responses. Failures retain only the last successful rows for the same covered interval, label them as stale, and do not use unrelated date ranges or fabricate values; failure of one source does not disable the other. Cache coverage and errors are scoped to the requested UTC dates and cleared with account-specific state.

Daily analytics rows, derived client/metric aggregates, and internal capability state are kept in memory only. The dashboard does not persist usage history, raw analytics responses, tokens, Credits, account identifiers, thread IDs, or client aggregates in `localStorage` or IndexedDB. Non-sensitive UI preferences may be persisted separately.

## Privacy and security

The script only sends requests to `chatgpt.com`. It does not upload account or usage data, add telemetry, call third-party services, or perform account mutations. It does not persist tokens, cookies, account IDs, thread IDs, session objects, email addresses, usernames, raw payloads, or usage snapshots. Only non-sensitive UI preferences are saved: panel position, collapsed state, compact/wide preference, section states, selected range, email visibility, chart metric, and custom start/end dates. Refresh is always fixed at five minutes and has no saved setting. Authentication values and Thread Usage input are never placed in the console, clipboard, or error text.

## Known limitations

- `/backend-api/wham/*` is an internal ChatGPT interface and may change without notice. Unknown fields are ignored and recognized fields remain best-effort.
- `plan_type` is a plan label, not proof of the complete billing or subscription lifecycle. The panel does not infer subscription validity from a plan name.
- Analytics data may be delayed or unavailable for an account or plan. Daily aggregation uses UTC date buckets where possible; the trend does not estimate or interpolate values.
- The model-breakdown Analytics data may be delayed or unavailable. Its percentages describe model usage share only; they do not provide model-level Token attribution. Prefer optional absolute model counts from Workspace Analytics only when all token classes reconcile; availability depends on the account and response.
- Authoritative cost data remains unavailable. The fallback API-equivalent scenario assumes the model usage shares can serve as allocation weights for each day's token classes. Actual model token distributions may differ substantially; neither path is an official bill or quota conversion.
- When a current quota period is represented as daily rows, the reset day can include data from outside the exact quota boundary.
- Percentages are shown only when supplied or safely derived from the other percentage; unknown percentages use an empty track and an explicit notice rather than a fabricated grey fill. The script does not invent an official total quota, message count, or token total.
- A real signed-in browser session is required for live account data. This repository validation cannot guarantee access to a user's private ChatGPT session.

## Automated regression tests

Run the dependency-free fixture suite with Node.js:

```sh
node --test scripts/chatgpt-com/account-usage-dashboard.test.cjs
```

The suite evaluates the actual userscript with startup disabled, using synthetic daily data, mocked requests, and a fixed clock. It covers UTC boundaries, preset/custom aggregation, multi-day model shares, cache reuse and forced replacement, independent source failures, obsolete range responses, compact/wide anchor restoration, remembered layout and launcher interaction, verified price arithmetic, selected-range daily estimates, missing/stale inputs, incomplete model distributions (including all-invalid days, split date buckets and successful cache replacement after refresh), reconciled absolute-model precedence, unknown prices, token-weighted coverage, daily audit details and client residual/mismatch handling. It does not replace the authenticated browser checks below.

## Manual test checklist

On a disposable browser profile or a signed-in ChatGPT session, verify:

1. The metadata installs and matches only `https://chatgpt.com/*`.
2. The compact launcher expands, collapses, drags with mouse and touch, remains in the viewport, and does not intercept normal chat input.
3. Refreshing or navigating within the SPA does not create duplicate hosts, observers, timers, or event handlers.
4. Light and dark themes, narrow viewports, keyboard focus, reduced motion, and screen-reader labels remain usable.
5. Signed-out, 401/403, 404, 429, timeout, empty-analytics, and partial-schema states remain understandable.
6. A usage response with missing, `null`, unknown, snake_case, camelCase, single-window, array, object, and additional-window shapes renders without an uncaught exception.
7. Switch among current cycle, month, 7 days, 30 days, and a custom range with different usage. The date caption, metrics, model pie/legend, client distribution, and trend match the same UTC interval; the range analysis, daily table, daily model rows and API-equivalent estimates follow that interval; real quota windows remain independent. The trend tooltip matches the returned value and the Analytics link works. Repeat with an older custom range, a canceled date draft, a rapid range switch while loading, a failed request, and a manual refresh.
8. The title bar contains refresh, official Analytics, expand/restore, and collapse. Check the initial compact panel, wide layout, collapse/reopen and reload of either remembered layout, launcher drag/click after closing wide mode, return to the original anchor, and narrow-viewport reflow in light/dark themes. Switching layout does not request data or change the selected date range, draft values, section state, or chart metric; no footer settings/link block is rendered.
9. Each first-level section expands and collapses independently, and section preferences persist across reloads. Verify known-price days, missing token classes, unknown models, malformed/missing model shares and identities, absolute-model reconciliation versus fallback, per-date audit rates/weights, token coverage, client residuals and discrepancies, partial and stale API-equivalent subtotals; never reinterpret them as Credits or true account cost.
10. Mock 403, 404, 429, 5xx, timeout, empty-Analytics, and schema-change responses remain understandable without uncaught errors.
11. Quota progress colors are continuous at 20%, 50%, 80%, and 95%; the percentage remains visible and the progressbar has accessible values.
12. Multiple model/speed rows merge correctly, zero values are hidden, the model pie chart and legend remain accessible, and daily model rows are grouped by date and sorted descending.
13. The console and copied diagnostics contain no token, cookie, account ID, thread ID, raw response, USD amount, or full email.

## Maintenance notes

If ChatGPT changes the internal endpoints or response shape, update the normalization and diagnostics code in the userscript first. Preserve the read-only boundary, in-memory authentication rule, partial-success behavior, and safe UI storage. Confirm the current endpoint behavior in an authenticated browser before changing field mappings; never add broad permissions or guess an undocumented Usage URL.
