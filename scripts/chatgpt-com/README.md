# ChatGPT Account Usage Dashboard

`account-usage-dashboard.user.js` adds a collapsible, draggable account-usage panel to `chatgpt.com`. It is a standalone Tampermonkey/Violentmonkey userscript and does not require a build step, package manager, or remote dependency.

## Installation

Install Tampermonkey or Violentmonkey, then open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/chatgpt-com/account-usage-dashboard.user.js) and confirm installation. Open or reload a `https://chatgpt.com/` page while signed in.

## Data sources and fallback behavior

The script only makes same-origin, read-only GET requests to the current ChatGPT page:

- `/api/auth/session` supplies the display name, masked email, and narrowly selected in-memory authentication fallback fields.
- `/backend-api/wham/usage` supplies the plan, rate-limit windows, credits, and usage state.
- `/backend-api/wham/analytics/daily-workspace-usage-counts` supplies one date range of optional daily statistics, which is then filtered and aggregated in memory for the displayed ranges.

The usage request first uses cookie-only credentials. A 401/403 response may trigger a session lookup and one authenticated retry using an access token and account ID held only in memory. Analytics is optional: a 403, 404, timeout, empty response, or schema change leaves the account and quota sections available and marks only the analytics area as unavailable or partial.

## Displayed fields

The compact view shows the plan, the primary available percentage, the nearest reset, and the current data state. The expanded panel can show:

- signed-in state, display name, masked email, raw `plan_type`, allowed/limit-reached state, and update time;
- every recognized primary and additional rate-limit window, with duration, used/remaining percentages, progress, reset time, countdown, and limit state;
- optional credits, reset-credit availability, and spend-control fields without treating missing or `null` values as zero;
- current quota period, month, last 7 days, and last 30 days, including credits, token classes, threads, turns, and dates with data;
- client aggregates sorted by tokens and a native CSS bar chart for the selected daily metric;
- a manual refresh, minute-based refresh selection, official Analytics link, conditionally discovered official Usage link, and safe diagnostics.

## Privacy and security

The script only sends requests to `chatgpt.com`. It does not upload account or usage data, add telemetry, call third-party services, or perform account mutations. It does not persist tokens, cookies, account IDs, session objects, email addresses, usernames, raw payloads, or usage snapshots. Only non-sensitive UI preferences are saved: panel position, collapsed state, selected range, refresh interval, email visibility, and chart metric. Authentication values are never placed in the DOM, console, clipboard, or error text.

## Known limitations

- `/backend-api/wham/*` is an internal ChatGPT interface and may change without notice. Unknown fields are ignored and recognized fields remain best-effort.
- `plan_type` is a plan label, not proof of the complete billing or subscription lifecycle. The panel does not infer subscription validity from a plan name.
- Analytics data may be delayed or unavailable for an account or plan. Daily aggregation uses UTC date buckets where possible.
- When a current quota period is represented as daily rows, the reset day can include data from outside the exact quota boundary.
- Percentages are shown only when supplied or safely derived from the other percentage; the script does not invent an official total quota or convert credits to dollars.
- A real signed-in browser session is required for live account data. This repository validation cannot guarantee access to a user's private ChatGPT session.

## Manual test checklist

On a disposable browser profile or a signed-in ChatGPT session, verify:

1. The metadata installs and matches only `https://chatgpt.com/*`.
2. The compact launcher expands, collapses, drags with mouse and touch, remains in the viewport, and does not intercept normal chat input.
3. Refreshing or navigating within the SPA does not create duplicate hosts, observers, timers, or event handlers.
4. Light and dark themes, narrow viewports, keyboard focus, reduced motion, and screen-reader labels remain usable.
5. Signed-out, 401/403, 404, 429, timeout, empty-analytics, and partial-schema states remain understandable.
6. A usage response with missing, `null`, unknown, snake_case, camelCase, single-window, array, object, and additional-window shapes renders without an uncaught exception.
7. Analytics ranges and client aggregates derive from one daily request, and the official Analytics link works.
8. The console and copied diagnostics contain no token, cookie, account ID, raw response, or full email.

## Maintenance notes

If ChatGPT changes the internal endpoints or response shape, update the normalization and diagnostics code in the userscript first. Preserve the read-only boundary, in-memory authentication rule, partial-success behavior, and safe UI storage. Confirm the current endpoint behavior in an authenticated browser before changing field mappings; never add broad permissions or guess an undocumented Usage URL.
