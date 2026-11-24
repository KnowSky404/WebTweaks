# ChatGPT Account Usage Dashboard

`account-usage-dashboard.user.js` adds a small floating usage icon to `chatgpt.com`. Click it to open the full, draggable account-usage panel. It is a standalone Tampermonkey/Violentmonkey userscript and does not require a build step, package manager, or remote dependency.

Version 1.6.0 synchronizes the selected UTC usage range across metrics, model usage share, client distribution, and daily trends, while keeping quota-cycle analysis independent. It adds a responsive wide dashboard alongside the existing compact floating panel. Cost calculation is disabled because the current account does not expose authoritative cost data.

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
- current cycle analysis derived from each quota window's `reset_at - limit_window_seconds`, including Tokens, Turns, Threads, daily model usage, and an optional estimated cycle capacity;
- a daily breakdown with date, Tokens, Turns, Threads, and the primary model;
- current quota period, month, last 7 days, and last 30 days, including server-supplied Credits, token classes, threads, turns, and dates with data;
- client aggregates sorted by tokens and a native CSS bar chart for the selected daily metric;
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

The launcher is a 44–48px draggable utility button with a generic usage/activity inline SVG, a subtle border and shadow, and a status indicator. A small pointer movement does not open the panel after a drag. The expanded panel uses the local `wt-` design tokens, a compact account summary, quota-window sections, analytics, title-bar icon actions, and collapsed diagnostics. It opens in the existing compact layout (approximately 400px wide), with an expand/restore icon in the top-right header. Wide mode is centered, up to 1120px wide with 12px viewport margins, and keeps scrolling inside the panel. On sufficiently wide screens, quota cards reflow into columns, Tokens/Turns/Threads use a three-column metric grid, model usage and client distribution sit side-by-side, and daily charts and tables have more space. Narrow viewports retain a single-column flow. Both layouts use the same data, range selection, theme, and section state.

The visual direction is a local adaptation of public [OpenAI Apps SDK UI](DESIGN.md#official-references) patterns. This is an unofficial userscript, not an OpenAI, ChatGPT, or Codex product. It does not use the OpenAI Logo, Blossom, wordmark, or other OpenAI marks; launcher icons are generic usage/activity symbols. See [`DESIGN.md`](DESIGN.md) for the complete site-level specification.

The launcher and compact panel share one size-independent viewport anchor. Dragging either updates that anchor; wide mode is centered and not draggable, and entering/leaving it never rewrites the compact anchor. Closing the panel or reloading the page returns to compact mode on the next open. Window-size changes may temporarily clamp the visible surface without overwriting the saved position.

## Model usage and cost contract

The model-usage breakdown belongs to Usage Statistics and comes from ChatGPT Analytics. A response with `units: "percent"` makes each model/speed value a usage percentage or model share. The source field is named `credits`, but the UI must not call it Credits, Token usage, or token percentage. Same-model/same-speed entries are merged per UTC date and then summed across the selected date buckets and normalized to 100% before descending sorting; zero values are omitted. Without authoritative per-day weights this is a normalized summary of the returned daily model values, not a token-weighted or independently verified account-wide consumption percentage. No token count is inferred from a percentage.

The current UI does not calculate or display API-equivalent value, USD, billing, or cost summaries. When the source field is `units: "percent"`, model `credits` values remain percentages (`模型使用占比`) and are never treated as Credits, Tokens, or USD.

The integration boundary uses the following provider architecture:

- `MODEL_PRICING` is a per-model table with input, cached-input, output prices, and an effective date. It must cover `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.5`; it must not substitute one global price for all models.
- A rate card entry with no source-confirmed price remains unavailable rather than becoming a guessed amount; the UI never turns model share into a dollar value.
- `estimateApiCost({ model, inputTokens, cachedInputTokens, outputTokens })` calculates uncached input cost plus cached input cost plus output cost. It must not multiply total Tokens by an average price or multiply a percentage by USD.
- `usageCostProviders` contains `threadUsageProvider`, `creditProvider`, and `tokenPricingProvider` as an internal extension seam only. These providers are not rendered as cost cards or billing values.

## Cost capability boundary

The internal provider seam retains future `thread_usage`, `real_credit`, and `token_estimate` capability names, but version 1.6.0 does not probe Thread Usage or render any cost result. Diagnostics report `Thread Usage: unavailable`, `Credit: unavailable` when no positive Credit data is present, and `costCapability: unavailable`. No response body, thread ID, account ID, cookie, access token, authorization header, USD amount, or billing estimate is shown or copied.

## Safe diagnostics

Diagnostics may expose only redacted state useful for troubleshooting: source availability, model-breakdown status, model-row count, request status, and safe window-shape metadata. They must never expose Token values, cookies, authorization values, account IDs, thread IDs, raw responses, USD values, or other authentication material. The same rule applies to the UI, console, clipboard, and persistent storage.

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

Preset ranges share a contiguous daily-data request per source covering the current quota cycle, current month, and last 30 days. Changing to a covered range uses the cached rows for both sources; an uncovered custom range requests its exact dates separately. Applying a valid custom range commits the selection synchronously, and late responses update only date-scoped caches. Canceling a draft leaves the committed range unchanged. The quota-cycle summary and its daily model rows always use the cycle range, not the selected Usage Statistics tab. Where no valid quota window is available, the existing 30-day fallback is explicitly labeled.

Manual and scheduled refreshes bypass coverage caches and replace rows inside the requested interval, including successful empty responses. Failures retain only the last successful rows for the same covered interval, label them as stale, and do not use unrelated date ranges or fabricate values; failure of one source does not disable the other. Cache coverage and errors are scoped to the requested UTC dates and cleared with account-specific state.

Daily analytics rows, derived client/metric aggregates, and internal capability state are kept in memory only. The dashboard does not persist usage history, raw analytics responses, tokens, Credits, account identifiers, thread IDs, or client aggregates in `localStorage` or IndexedDB. Non-sensitive UI preferences may be persisted separately.

## Privacy and security

The script only sends requests to `chatgpt.com`. It does not upload account or usage data, add telemetry, call third-party services, or perform account mutations. It does not persist tokens, cookies, account IDs, thread IDs, session objects, email addresses, usernames, raw payloads, or usage snapshots. Only non-sensitive UI preferences are saved: panel position, collapsed state, selected range, email visibility, chart metric, and custom start/end dates. Refresh is always fixed at five minutes and has no saved setting. Authentication values and Thread Usage input are never placed in the console, clipboard, or error text.

## Known limitations

- `/backend-api/wham/*` is an internal ChatGPT interface and may change without notice. Unknown fields are ignored and recognized fields remain best-effort.
- `plan_type` is a plan label, not proof of the complete billing or subscription lifecycle. The panel does not infer subscription validity from a plan name.
- Analytics data may be delayed or unavailable for an account or plan. Daily aggregation uses UTC date buckets where possible; the trend does not estimate or interpolate values.
- The model-breakdown Analytics data may be delayed or unavailable. Its percentages describe model usage share only; they do not provide model-level Token attribution, and therefore cannot support a dollar amount on their own.
- Cost data is intentionally unavailable in the UI. The internal capability seam remains for a future authoritative source, but no current endpoint is treated as a billing source.
- When a current quota period is represented as daily rows, the reset day can include data from outside the exact quota boundary.
- Percentages are shown only when supplied or safely derived from the other percentage; unknown percentages use an empty track and an explicit notice rather than a fabricated grey fill. The script does not invent an official total quota, message count, or token total.
- A real signed-in browser session is required for live account data. This repository validation cannot guarantee access to a user's private ChatGPT session.

## Automated regression tests

Run the dependency-free fixture suite with Node.js:

```sh
node --test scripts/chatgpt-com/account-usage-dashboard.test.cjs
```

The suite evaluates the actual userscript with startup disabled, using synthetic daily data, mocked requests, and a fixed clock. It covers UTC boundaries, preset/custom aggregation, multi-day model shares, cache reuse and forced replacement, independent source failures, obsolete range responses, and compact/wide anchor restoration. It does not replace the authenticated browser checks below.

## Manual test checklist

On a disposable browser profile or a signed-in ChatGPT session, verify:

1. The metadata installs and matches only `https://chatgpt.com/*`.
2. The compact launcher expands, collapses, drags with mouse and touch, remains in the viewport, and does not intercept normal chat input.
3. Refreshing or navigating within the SPA does not create duplicate hosts, observers, timers, or event handlers.
4. Light and dark themes, narrow viewports, keyboard focus, reduced motion, and screen-reader labels remain usable.
5. Signed-out, 401/403, 404, 429, timeout, empty-analytics, and partial-schema states remain understandable.
6. A usage response with missing, `null`, unknown, snake_case, camelCase, single-window, array, object, and additional-window shapes renders without an uncaught exception.
7. Switch among current cycle, month, 7 days, 30 days, and a custom range with different usage. The date caption, metrics, model pie/legend, client distribution, and trend match the same UTC interval; the cycle summary and daily model rows remain independent. The trend tooltip matches the returned value and the Analytics link works. Repeat with an older custom range, a canceled date draft, a rapid range switch while loading, a failed request, and a manual refresh.
8. The title bar contains refresh, official Analytics, expand/restore, and collapse. Check the default compact panel, wide layout, return to the original anchor, and narrow-viewport reflow in light/dark themes. Switching layout does not request data or change the selected date range, draft values, section state, or chart metric; no footer settings/link block is rendered.
9. Each first-level section expands and collapses independently, and only those section states persist across reloads.
10. Mock 403, 404, 429, 5xx, timeout, empty-Analytics, and schema-change responses remain understandable without uncaught errors.
11. Quota progress colors are continuous at 20%, 50%, 80%, and 95%; the percentage remains visible and the progressbar has accessible values.
12. Multiple model/speed rows merge correctly, zero values are hidden, the model pie chart and legend remain accessible, and daily model rows are grouped by date and sorted descending.
13. The console and copied diagnostics contain no token, cookie, account ID, thread ID, raw response, USD amount, or full email.

## Maintenance notes

If ChatGPT changes the internal endpoints or response shape, update the normalization and diagnostics code in the userscript first. Preserve the read-only boundary, in-memory authentication rule, partial-success behavior, and safe UI storage. Confirm the current endpoint behavior in an authenticated browser before changing field mappings; never add broad permissions or guess an undocumented Usage URL.
