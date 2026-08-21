# ChatGPT Account Usage Dashboard

`account-usage-dashboard.user.js` adds a small floating usage icon to `chatgpt.com`. Click it to open the full, draggable account-usage panel. It is a standalone Tampermonkey/Violentmonkey userscript and does not require a build step, package manager, or remote dependency.

Version 1.4.0 adds cycle analysis, Codex Credit consumption analysis, API-equivalent value, and a daily cost breakdown. It keeps the model-breakdown endpoint's percentage semantics separate from real Codex Credits.

## Installation

Install Tampermonkey or Violentmonkey, then open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/chatgpt-com/account-usage-dashboard.user.js) and confirm installation. Open or reload a `https://chatgpt.com/` page while signed in.

## Data sources and fallback behavior

The script only makes same-origin, read-only requests to the current ChatGPT page:

- `/api/auth/session` supplies the display name, masked email, and narrowly selected in-memory authentication fallback fields.
- `/backend-api/wham/usage` supplies the plan, rate-limit windows, credits, and usage state.
- `/backend-api/wham/analytics/daily-workspace-usage-counts` supplies one date range of optional daily statistics, which is then filtered and aggregated in memory for the displayed ranges.
- `daily-workspace-usage-counts[].totals.credits` is the Codex Credit source. Positive Credits are converted at `USD = Credits * 0.04` (`1000 Credits ≈ $40`); missing or zero Credits remain unavailable rather than becoming a fake `$0`.
- `/backend-api/wham/usage/daily-token-usage-breakdown` is the Analytics data source for the model-usage breakdown. Its `credits` field is interpreted according to the response's `units: "percent"` declaration as a percentage/model-usage share, not as the dashboard's Credits field and not as a token percentage.
- `/backend-api/wham/usage/thread_usage/query` is used only after the user starts the diagnostic action and supplies a real UUID-form Codex thread ID. It receives one `POST` body containing that ID and is never used for automatic history scanning.

The usage and Thread Usage requests first use cookie-only credentials. A 401/403 response may trigger a session lookup and one authenticated retry using an access token and account ID held only in memory; neither value is persisted or displayed. Analytics is optional: a 403, 404, timeout, empty response, or schema change leaves the account and quota sections available and marks only the analytics area as unavailable or partial. The normalizer understands primary/secondary windows inside `rate_limit`, arrays and maps under `rate_limits`, and wrapped `additional_rate_limits` entries. The model-breakdown endpoint is also optional and is treated as Analytics data; it is not a thread-level token ledger.

## Displayed fields

The compact view is only an icon with an optional health dot; it does not show the plan, percentages, or countdown. The expanded panel can show:

- signed-in state, display name, masked email, plan context (including `Pro Lite` as a plan tier), usage status, and update time;
- every recognized primary and additional rate-limit window, with duration, used/remaining percentages, progress, reset time, countdown, and limit state;
- optional Credits and spend-control fields only when the server supplies values, without treating missing or `null` values as zero;
- current cycle analysis derived from each quota window's `reset_at - limit_window_seconds`, including Tokens, Turns, Credits, API-equivalent value, and an optional estimated cycle capacity;
- a daily breakdown with date, Tokens, Credits, API value, and Turns. Daily API value is shown only when that row has positive `totals.credits`;
- current quota period, month, last 7 days, and last 30 days, including server-supplied Credits, token classes, threads, turns, and dates with data;
- client aggregates sorted by tokens and a native CSS bar chart for the selected daily metric;
- model usage rows when the model-breakdown data is available: the same model and speed are merged, rows are sorted in descending share order, zero-valued rows are hidden, and the value is shown as a percentage/model-usage share. The field is never presented as `Credits`, `Token usage`, or a fabricated token count;
- source-aware API-equivalent value status with a visible source and confidence. The dashboard never labels subscription usage as actual billing;
- manual refresh;
- fixed five-minute automatic refresh;
- opening official Analytics in a new tab;
- collapsing the panel;
- safe diagnostics;
- a collapsed Thread Usage API diagnostic showing endpoint status, capability fields, and last-check time. The entered thread ID is never shown in diagnostics.

## UI design and product boundary

The launcher is a 44–48px draggable utility button with a generic usage/activity inline SVG, a subtle border and shadow, and a status indicator. A small pointer movement does not open the panel after a drag. The expanded panel uses the local `wt-` design tokens, a compact account summary, quota-window sections, analytics, title-bar icon actions, and collapsed diagnostics. It is sized for approximately 400px while remaining usable at narrow viewports.

The visual direction is a local adaptation of public [OpenAI Apps SDK UI](DESIGN.md#official-references) patterns. This is an unofficial userscript, not an OpenAI, ChatGPT, or Codex product. It does not use the OpenAI Logo, Blossom, wordmark, or other OpenAI marks; launcher icons are generic usage/activity symbols. See [`DESIGN.md`](DESIGN.md) for the complete site-level specification.

The launcher and expanded panel share one size-independent viewport anchor. Expanding and collapsing therefore do not change the saved user position; dragging either state updates that anchor. Window-size changes may temporarily clamp the visible surface into the viewport without overwriting the saved position.

## Model usage and cost contract

The model-usage breakdown belongs to Usage Statistics and comes from ChatGPT Analytics. A response with `units: "percent"` makes each model/speed value a usage percentage or model share. The source field is named `credits`, but the UI must not call it Credits, Token usage, or token percentage. Same-model/same-speed entries are merged before descending sorting; zero values are omitted, and no token count is inferred from a percentage.

Cost source priority is explicit:

1. authoritative USD returned by `/backend-api/wham/usage/thread_usage/query`;
2. positive `daily-workspace-usage-counts[].totals.credits`, converted with `Credits * 0.04`;
3. reliable model-level Token pricing;
4. unavailable.

Every result contains `valueUsd`, `source`, and `confidence`. A value is labeled `API 等价价值`, never actual billing. When the source field is `units: "percent"`, model `credits` values remain percentages (`模型消耗占比`) and never enter the USD conversion.

The integration boundary uses the following provider architecture:

- `MODEL_PRICING` is a per-model table with input, cached-input, output prices, and an effective date. It must cover `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.5`; it must not substitute one global price for all models.
- A rate card entry with no source-confirmed price remains unavailable rather than becoming a guessed amount; the current UI never turns model share into a dollar value.
- `estimateApiCost({ model, inputTokens, cachedInputTokens, outputTokens })` calculates uncached input cost plus cached input cost plus output cost. It must not multiply total Tokens by an average price or multiply a percentage by USD.
- `usageCostProviders` contains `threadUsageProvider`, `creditProvider`, and `tokenPricingProvider`. The Credit provider is the only provider allowed to convert daily-workspace Credits. A zero Credit value with positive Tokens is shown as `Credit数据不可用`, not `$0`.

## Thread Usage capability probe

The collapsed `诊断信息` area contains `检测 Thread Usage 能力`. The small dialog accepts a UUID-form Codex thread ID, prefilling the current `/c/<thread-id>` page ID only when it is already present in the page URL. A valid ID triggers exactly one `POST /backend-api/wham/usage/thread_usage/query` request with `{"thread_ids":["<thread-id>"]}`; an invalid UUID is rejected before any request. The value is kept in memory only and is cleared on page refresh or when the dialog closes.

The probe reports four independent facts: whether the endpoint responded, whether thread data was returned, whether any group exposed Token fields, and whether the response exposed server-estimated USD or Credits micros fields. If authoritative USD micros are present, that in-memory result has the highest cost priority; otherwise daily Codex Credits remain the next source. A 200 response with an empty `threads` array is reported as `接口可访问，但没有返回可查询线程数据`, not as a definitive account restriction. A 403 means the endpoint exists but the account may not have permission; a 404 means the endpoint is unavailable or hidden; a timeout is reported as `检测超时`. The thread ID is visible only in the temporary input; no response body, thread ID, account ID, cookie, access token, or authorization header is shown in diagnostics or copied.

## Safe diagnostics

Diagnostics may expose only redacted state useful for troubleshooting: `creditAvailable`, `creditSource=daily-workspace`, `costSource`, confidence, model-breakdown status, model-row count, and Thread Usage status/capabilities/check time. They must never expose Token values, cookies, authorization values, account IDs, thread IDs, raw responses, or other authentication material. The same rule applies to the UI, console, clipboard, and persistent storage.

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

Custom dates use UTC date buckets and an inclusive UI end date: `2026-08-01 — 2026-08-14` includes August 14. The request boundary converts that end date to the next UTC date for exclusive filtering. A custom range must be valid, must not end in the future, and is limited to a maximum of 366 days as a project-side defensive limit, not an OpenAI API limit.

Daily analytics rows, derived client/metric aggregates, and Thread Usage probe input/results are kept in memory only. The dashboard does not persist usage history, raw analytics responses, tokens, Credits, account identifiers, thread IDs, or client aggregates in `localStorage` or IndexedDB. Non-sensitive UI preferences may be persisted separately.

## Privacy and security

The script only sends requests to `chatgpt.com`. It does not upload account or usage data, add telemetry, call third-party services, or perform account mutations. It does not persist tokens, cookies, account IDs, thread IDs, session objects, email addresses, usernames, raw payloads, or usage snapshots. Only non-sensitive UI preferences are saved: panel position, collapsed state, selected range, email visibility, chart metric, and custom start/end dates. Refresh is always fixed at five minutes and has no saved setting. Authentication values and Thread Usage input are never placed in the console, clipboard, or error text.

## Known limitations

- `/backend-api/wham/*` is an internal ChatGPT interface and may change without notice. Unknown fields are ignored and recognized fields remain best-effort.
- `plan_type` is a plan label, not proof of the complete billing or subscription lifecycle. The panel does not infer subscription validity from a plan name.
- Analytics data may be delayed or unavailable for an account or plan. Daily aggregation uses UTC date buckets where possible; the trend does not estimate or interpolate values.
- The model-breakdown Analytics data may be delayed or unavailable. Its percentages describe model usage share only; they do not provide model-level Token attribution, and therefore cannot support a dollar amount on their own.
- Thread Usage is queried only after an explicit diagnostic action and needs a real thread ID. Its authoritative USD, when returned, has priority for the in-memory value result; absence of that field falls through to daily Codex Credits. No result is presented as actual ChatGPT billing.
- When a current quota period is represented as daily rows, the reset day can include data from outside the exact quota boundary.
- Percentages are shown only when supplied or safely derived from the other percentage; unknown percentages use an empty track and an explicit notice rather than a fabricated grey fill. The script does not invent an official total quota, message count, or token total.
- A real signed-in browser session is required for live account data. This repository validation cannot guarantee access to a user's private ChatGPT session.

## Manual test checklist

On a disposable browser profile or a signed-in ChatGPT session, verify:

1. The metadata installs and matches only `https://chatgpt.com/*`.
2. The compact launcher expands, collapses, drags with mouse and touch, remains in the viewport, and does not intercept normal chat input.
3. Refreshing or navigating within the SPA does not create duplicate hosts, observers, timers, or event handlers.
4. Light and dark themes, narrow viewports, keyboard focus, reduced motion, and screen-reader labels remain usable.
5. Signed-out, 401/403, 404, 429, timeout, empty-analytics, and partial-schema states remain understandable.
6. A usage response with missing, `null`, unknown, snake_case, camelCase, single-window, array, object, and additional-window shapes renders without an uncaught exception.
7. Analytics ranges and client aggregates derive from one daily request, the daily trend Tooltip matches the returned row value, the model breakdown is identified as a percentage/model share from Analytics, the cycle summary uses the quota window reset calculation, and the title-bar Analytics link works.
8. The title bar contains only refresh, official Analytics, and collapse; no footer settings/link block is rendered.
9. The Thread Usage diagnostic rejects an invalid UUID without a network request, sends only the documented POST for a valid ID, and keeps the input out of storage and copied diagnostics.
10. Mock 403, 404, 429, 5xx, timeout, and 200-empty-thread responses remain understandable; the empty response is not labeled as a definitive unsupported account.
11. Positive `totals.credits` displays Credits and `Credits * 0.04`; `credits=0` with positive Tokens displays `Credit数据不可用` without `$0`; the daily table never shows API value without row Credits; model percentages never become USD.
12. The console and copied diagnostics contain no token, cookie, account ID, thread ID, raw response, or full email; safe Thread Usage fields are limited to status, HTTP result, capability booleans, and check time.

## Maintenance notes

If ChatGPT changes the internal endpoints or response shape, update the normalization and diagnostics code in the userscript first. Preserve the read-only boundary, in-memory authentication rule, partial-success behavior, and safe UI storage. Confirm the current endpoint behavior in an authenticated browser before changing field mappings; never add broad permissions or guess an undocumented Usage URL.
