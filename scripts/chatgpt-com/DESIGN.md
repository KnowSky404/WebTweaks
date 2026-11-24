# ChatGPT Account Usage Dashboard Design

This is the site-level visual and interaction specification for the ChatGPT account usage dashboard userscript. It describes a local, read-only adaptation for a userscript injected into `chatgpt.com`; it is not an OpenAI, ChatGPT, or Codex product, and it does not reproduce an official product UI.

## Scope

- Apply the system to the floating launcher and the expanded account-usage panel.
- Keep the dashboard independently installable as readable userscript source with no build step, runtime dependency, CDN, React, or Tailwind dependency.
- Keep data access same-origin, read-only, and in memory except for non-sensitive UI preferences explicitly needed for the local experience.
- Keep injected identifiers and CSS classes scoped with the `wt-` prefix.
- Treat ChatGPT's page theme as authoritative for the injected surface and remain usable at narrow widths.

This document governs visual decisions and interaction contracts. It does not define undocumented ChatGPT API fields, quota values, billing status, or a promise that any internal endpoint will remain stable.

## Official references

References were checked on **2026-08-14**:

- [OpenAI Apps SDK UI repository](https://github.com/openai/apps-sdk-ui), the official open-source design system reference for accessible ChatGPT app surfaces.
- [Apps SDK UI `src/styles`](https://github.com/openai/apps-sdk-ui/tree/main/src/styles), including [`variables-primitive.css`](https://github.com/openai/apps-sdk-ui/blob/main/src/styles/variables-primitive.css), [`variables-semantic.css`](https://github.com/openai/apps-sdk-ui/blob/main/src/styles/variables-semantic.css), [`variables-components.css`](https://github.com/openai/apps-sdk-ui/blob/main/src/styles/variables-components.css), and [`base.css`](https://github.com/openai/apps-sdk-ui/blob/main/src/styles/base.css).
- [OpenAI Design Guidelines](https://openai.com/brand/), used for trademark, logo, typography, and non-endorsement boundaries.
- [Codex Pricing](https://chatgpt.com/codex/pricing/), used only as a product-language and plan-tier reference. It is not a source for hardcoded dashboard quota calculations.
- [Codex rate card](https://help.openai.com/en/articles/20001106-codex-rate-card), used as a separate official pricing reference where token-based credit behavior is relevant.

The `apps-sdk-ui` `main` branch commit was readable through the GitHub API during this check and resolved to `0f00143c7a639906f1621fe58e1b6be7b5bea46d` ([commit](https://github.com/openai/apps-sdk-ui/commit/0f00143c7a639906f1621fe58e1b6be7b5bea46d)). This is a dated reference snapshot, not a permanent pin or a claim that the branch cannot change later.

The references inform roles, contrast, density, accessible component behavior, and theme handling. The userscript uses local CSS and generic controls rather than importing the Apps SDK UI package.

## Design principles

1. **Quiet utility:** the launcher stays present without competing with ChatGPT's composer or navigation.
2. **Information hierarchy:** identity and quota state come before detail, diagnostics, and links.
3. **Progressive disclosure:** show the useful summary first; keep low-frequency settings and diagnostics secondary.
4. **Truthful uncertainty:** missing percentages, limits, dates, or analytics remain visibly unknown instead of becoming invented zeroes.
5. **Neutral surfaces:** use restrained borders and elevation; do not turn every row into a heavy card.
6. **Local adaptation:** borrow public design-system patterns and semantic roles, not OpenAI marks, proprietary product chrome, or an official-looking identity.
7. **Reliable source boundary:** distinguish observed metrics from hypothetical API-equivalent calculations; unavailable authoritative cost capability stays unavailable.
8. **Defensive interaction:** initialization, navigation, theme synchronization, drag behavior, and event binding must be idempotent.

## Data semantics and integration contracts

The 1.7.1 contract treats `/backend-api/wham/usage/daily-token-usage-breakdown` as a ChatGPT Analytics data source. When the response declares `units: "percent"`, its `credits` values mean percentage/model-usage share. The UI must render them only as `模型使用占比` and never treat them as Credits, Tokens, or USD. Real Codex Credit data, when present, remains separate from model shares.

### Model usage component

The model-usage component sits inside Usage Statistics and uses a native conic-gradient pie with an accessible legend rather than implying a token ledger. Merge same-model/same-speed rows per UTC date, filter the daily buckets by the selected range, sum the returned values and normalize the selected total to 100%, then sort descending and hide zero-valued rows. Preserve each day's completeness flag before dropping invalid rows; any unrecognized share or positive-share model identity invalidates the day, while a valid zero-share row has no weight. Exclude incomplete days from the aggregate pie, label the exclusion and identify incomplete daily detail. Do not apply the per-row percentage validation limit to multi-day sums. Explain that the normalized summary of daily model values is not a token-weighted share; authoritative weighting is not available. Do not infer or display fake token counts from these shares. Keep account-level Credits semantically separate from the Analytics response field named `credits`.

### Cost capability boundary

Version 1.7.1 adds a separate API-equivalent reference scenario in Range Analysis. Normalize each day's returned model shares and explicitly assume the same weights for uncached input, cached input, and output Tokens. Price the hypothetical allocations using the dated local Standard text-token rate snapshot documented in [README.md](README.md#api-equivalent-scenario-usd), then sum the daily estimates. Do not equate model shares with observed model-level Tokens. Exclude any day missing a token class, valid total, complete model distribution, or any participating model's rate. A missing or malformed share/positive-share identity must invalidate the distribution before normalization, preventing redistribution of unknown weight to remaining models. Keep incomplete dates in the cache with their completeness flag, and replace the flag and rows together on successful refresh. Show priced/returned/calendar date counts and label partial/stale results. Display a dated rate basis and exclusions near the value, with per-model estimates in a disclosure and per-day estimates in the table. Never extrapolate API-equivalent USD to official Credits, quota capacity, or actual bills. The internal `thread_usage`, `real_credit`, and `token_estimate` seam remains separate; diagnostics report `costCapability: unavailable` for authoritative cost and only the API-equivalent scenario capability label.

### Data-source diagnostics

The collapsed `诊断信息` section reports `Workspace Analytics`, `Model Breakdown`, `Thread Usage`, `Credit`, and `costCapability` as safe availability values. It never probes Thread Usage during normal refresh and never displays a response body, Thread ID, account ID, cookie, token, authorization header, or cost value.

## Color tokens

These are local `wt-` role tokens. They are an adapter vocabulary, not a copy of the official Apps SDK UI token API. Values should remain neutral and should be revised together for light and dark surfaces.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--wt-color-bg` | `#ffffff` | `#202123` | Panel and launcher surface |
| `--wt-color-surface` | `#f7f7f8` | `#2a2b2f` | Secondary controls and quota surfaces |
| `--wt-color-surface-secondary` | `#f0f0f1` | `#34353a` | Selected controls and progress tracks |
| `--wt-color-text` | `#202123` | `#f7f7f8` | Primary text |
| `--wt-color-text-secondary` | `#5f6368` | `#b5b5bd` | Metadata and secondary text |
| `--wt-color-text-tertiary` | `#8b8d91` | `#8f9198` | Low-emphasis labels |
| `--wt-color-border` | `#d9d9df` | `#4a4b52` | Interactive outlines |
| `--wt-color-border-subtle` | `#e8e8eb` | `#38393e` | Section dividers |
| `--wt-color-primary` | `#202123` | `#f7f7f8` | Neutral primary action |
| `--wt-color-primary-hover` | `#35363a` | `#ffffff` | Primary action hover |
| `--wt-color-primary-text` | `#ffffff` | `#202123` | Text on primary action |
| `--wt-color-focus` | `#2563eb` | `#70a7ff` | Focus ring |
| `--wt-color-success` | `#159447` | `#48c774` | Normal/available state |
| `--wt-color-warning` | `#b86a08` | `#f1ad42` | Partial, stale, or incomplete state |
| `--wt-color-danger` | `#c43d32` | `#ff7b72` | Error or reached-limit state |

Color is never the only state signal. Pair status colors with text, an accessible name, an icon or shape, and an inline explanation where useful. Do not use an OpenAI brand color as a claim of affiliation.

## Typography

- Use a local system sans stack: `ui-sans-serif, -apple-system, system-ui, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`.
- Use a readable 13px body size with approximately 1.45 line height.
- Use 14px semibold titles, 13px semibold section labels, 12px secondary metadata, and 11px compact field labels.
- Use weight and spacing for hierarchy before introducing large type or decorative treatment.
- Use tabular or stable numeric alignment where it improves comparison of percentages, counts, and reset times.
- Do not load OpenAI Sans remotely or imply that the userscript is licensed as an OpenAI brand implementation. The OpenAI typography guidance is a reference, not an instruction to redistribute a brand font.

## Spacing

Use a 4px base unit and keep the compact panel deliberately dense:

- 4px: icon-to-label or micro separation;
- 8px: control gaps, compact fields, and quota-card internals;
- 12px: section padding, launcher inset, and normal control gaps;
- 16px: panel shell padding and major group separation;
- 24px: only for a clear top-level transition or generous empty state.

Prefer one consistent gap between siblings over repeated ad-hoc margins. On narrow screens, preserve readable text and touch targets before preserving decorative whitespace.

## Radius and shadows

- Launcher: 14px radius, 44–48px square hit area.
- Panel shell: 16px radius.
- Quota surface and compact fields: 10–12px radius.
- Badges and progress tracks: full pill radius.
- Use one light elevation for the floating surface, approximately `0 16px 50px rgb(0 0 0 / 22%)`; dark mode may use a stronger alpha but not a harsher outline.
- Avoid nested shadows, glossy gradients, glass effects, and large shadows on every row.
- Keep borders subtle and use them to separate adjacent information when a shadow would be excessive.

## Layout

The launcher is a compact, draggable utility button with a generic usage/activity inline SVG. It is visually centered, has a light border and shadow, and exposes a small status indicator. A small pointer movement must not be mistaken for a click; dragging must not open the panel. Its position is stored as a size-independent viewport anchor (`left`/`right` plus `top`/`bottom` offsets), so the same anchor can position both modes.

The default expanded panel is approximately 400px wide with `max-width: calc(100vw - 24px)` and a body height near 70vh. It stays within the viewport after dragging. Near the right edge it expands to the left, and near the bottom it expands upward, while retaining the same viewport anchor as the launcher.

The top-right expand/restore action switches to a centered wide layout up to 1120px, inset at least 12px from the viewport edges. The panel height is bounded by the viewport; its body scrolls independently and the header remains visible. Wide mode is not draggable. Above 760px viewport width, use responsive quota-card columns, a three-column metric grid, side-by-side model and client distributions, a taller daily chart, and roomier daily detail rows; below that breakpoint preserve the single-column layout. Keep a single shared component tree, visual token set, and statistics state in both layouts. Toggle only layout attributes and geometry, not data or the DOM tree; restore the saved compact anchor on exit. The selected layout is saved as an independent non-sensitive preference; collapsing, reopening and reloading restore it. Default to compact when no valid preference exists. A collapsed launcher uses its compact anchor and remains draggable regardless of the remembered preference.

Its structure is:

1. Header: `用量与额度`, update/status text, refresh, official Analytics icon, expand/restore, and collapse control.
2. Compact account summary: identity and plan badge in one block, with no redundant full-width “signed in” row.
3. Quota windows: primary and additional windows, percentages when known, progress, reset time, countdown, and state.
4. Usage statistics: selected range, Tokens, token subtypes, Turns, Threads, client distribution, model usage percentage, and a native CSS/SVG daily trend.
5. Range analysis: the committed interval, Tokens, Turns, Threads, explicitly hypothetical API-equivalent USD estimate, daily date/Tokens/Turns/Threads/primary-model/estimated-USD table, and daily model usage. Show actual quota-window context and real-Credit extrapolation only when the current cycle is selected.
6. Footer: diagnostics and necessary explanatory notices only; automatic refresh is fixed at five minutes and has no settings UI.
7. Diagnostics: collapsed by default and safe to copy.

## Analytics range contract

- Internally use a single UTC half-open interval `[start, end)` for selected statistics. Preserve the source-specific request convention: exclusive end for Workspace Analytics, inclusive end for Model Breakdown.
- Maintain independent in-memory daily rows, successful date coverage, and failed date intervals for the two sources. Prefetch one common preset envelope per source and fetch uncovered custom ranges separately; never issue per-day requests. A range change recomputes every aggregate from that same interval. Range Analysis, daily model rows and API-equivalent calculations use the same committed range as Usage Statistics. The actual quota window, remaining percentage and reset time stay independent.
- Refresh bypasses coverage and replaces the requested interval, rather than only appending returned days. Do not render uncovered partial aggregates as complete. Keep same-range cached data with a stale notice when a refresh fails; an unrelated successful request must not clear that notice. Reject stale account results and never let an asynchronous response change the committed selection.
- Keep model percentages, actual Credits, and Tokens distinct. No new request hosts, dependencies, or persistent usage data.

## Interaction and position lifecycle

- The stored position is a versioned viewport anchor, not a mutable mode-specific `left`/`top` pair.
- Compact/launcher renders apply an effective, viewport-clamped anchor but never write that temporary clamp back to the stored anchor. Wide mode is centered independently and never changes the persisted anchor. Layout changes must preserve range, drafts, open sections, and focus without causing another request.
- Dragging either the launcher or the compact panel uses temporary coordinates during movement. On pointer release, the actual surface rectangle is converted back into a shared anchor and persisted once; a click without movement keeps the launcher toggle behavior.
- Legacy `{ left, top }` preferences are clamped and converted to the anchor format after the first laid-out frame. Resize handling reapplies the stored anchor without creating a preference-write loop.

The panel should use a small number of clear sections rather than a stack of visually heavy cards. A two-column metric grid is preferred for compact statistics; it may collapse to one column when the available width requires it.

## Components

- **Launcher:** generic usage/gauge/activity icon, `currentColor`, `viewBox="0 0 24 24"`, round line caps and joins, plus a text-accessible status label.
- **Header:** one clear title, a low-emphasis update state, manual refresh, official Analytics, expand/restore, and collapse; every icon control has an accessible name. The header has exactly four controls, each using the same 40 × 40px border-box; the expand/restore action exposes `aria-pressed` and an updated accessible label. Analytics is the only retained official navigation link, and its visual dimensions match the button controls. The dashboard does not dynamically discover or display an official Usage shortcut.
- **Account summary:** display name and masked email together when available; show a plan badge beside that identity; omit missing fields rather than leaving blank rows.
- **Quota window:** name, primary/additional context, used and remaining values, progressbar, reset information, and textual state.
- **Badge and indicator:** compact semantic status, never status by color alone.
- **Metric grid:** Tokens, Turns, and Threads first; cached input, uncached input, output tokens, and date count are secondary detail. The Analytics model-breakdown `credits` field is a percentage/model share and must not be placed in a Credits metric.
- **Range analysis:** use the committed UTC date interval for all daily metrics, model usage and API-equivalent estimates. Derive the actual quota period from `reset_at - limit_window_seconds` without hardcoding durations; display real-Credit capacity extrapolation only for a selected real current cycle with supporting data.
- **Daily breakdown:** show date, Tokens, Turns, Threads, primary model and API-equivalent estimated USD. Missing values remain visibly unknown and excluded dates have an explanation. Preserve horizontal scrolling at narrow widths.
- **Client distribution:** client name, token share, and a compact secondary metrics line; avoid an unreadable sentence of equal-weight numbers.
- **Model usage distribution:** model and speed labels with merged, descending percentage shares; hide zero values, render a native conic-gradient pie chart, provide legend tooltips, and never invent token counts. This component identifies the values as Analytics/model usage share, not Token usage.
- **Data-source diagnostics:** show safe availability values for Workspace Analytics, Model Breakdown, Thread Usage, Credit, and `costCapability`; do not show cost amounts or provider internals.
- **Daily trend:** native CSS only; each bar is the actual Analytics value for one UTC date bucket, with a custom Tooltip for hover, focus, and touch that preserves source precision and does not estimate missing dates as zero.
- **Range selector:** compact keyboard-operable control for current cycle, month, 7 days, 30 days, and custom. Display exact inclusive UTC date bounds. The committed range filters metrics, model shares, clients, and trend together; opening a custom draft does not change that range. Range Analysis and its daily model rows and API-equivalent scenario follow that same committed range; actual quota windows remain independent.
- **Custom date editor:** native date inputs with labels, inclusive end-date language, inline validation, apply/cancel, and an `aria-live` error region.
- **Footer and diagnostics:** necessary explanatory notices and a safe, collapsed diagnostic disclosure; no settings or official-link footer. Safe diagnostics may include source availability, model-breakdown status, model-row count, request status, and window-shape metadata only.

## Theme behavior

The injected surface follows the ChatGPT page, not the operating system alone. Detect in this order:

1. An explicit ChatGPT root theme or `data-theme` value;
2. a dark class on `html` or `body`;
3. an applicable `color-scheme` value;
4. page background luminance;
5. `prefers-color-scheme` as the final fallback.

Set `data-wt-theme="light"` or `data-wt-theme="dark"` on the userscript host and resolve the local tokens from that attribute. A theme change updates the existing host without re-fetching data, duplicating listeners, or replacing the host. Observe only the necessary theme attributes and disconnect observers during teardown.

## Motion

- Use short, purposeful transitions for panel visibility, surface color, and focus state, generally 120–180ms.
- A launcher click may open the panel, but dragging must not trigger a second interaction.
- Use a small active-state press rather than a scale bounce, spin, shimmer, or celebratory animation.
- Loading state may use a static label or restrained indicator; it must not clear valid data.
- Honor `prefers-reduced-motion: reduce` by removing nonessential transitions and animation while keeping state changes understandable.

## Accessibility

- Give every icon button an `aria-label`; give tooltips an accessible name or equivalent text.
- Keep all interactive controls keyboard reachable with a clear `:focus-visible` ring.
- Use native buttons, links, selects, and date inputs where they fit the interaction.
- Keep touch targets around 40px or larger, with the launcher at 44–48px.
- Label both custom date inputs and explain that the end date is inclusive.
- Announce validation and asynchronous analytics errors through a nearby `aria-live="polite"` region.
- Expose known progress as `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, and `aria-valuemax`; omit `aria-valuenow` when the percentage is unknown.
- Do not communicate status, limit, or error only through color.
- Preserve readable focus order, sensible heading structure, sufficient contrast, and narrow-screen reflow.

## Branding restrictions

This userscript is unofficial and must not imply sponsorship, endorsement, partnership, or ownership by OpenAI, ChatGPT, or Codex. Do not use the OpenAI wordmark, Blossom/logo, ChatGPT logo, GPT mark, or a derivative of any of them. Do not use an OpenAI logo as the launcher icon.

Use only generic activity, usage, gauge, chart, refresh, settings, and collapse icons drawn as simple inline SVG. Do not alter, recolor, crop, or incorporate an OpenAI mark into the userscript's own identity. Keep the userscript name and repository attribution visible in documentation, and link to official pages as references rather than presenting them as endorsements.

## Anti-patterns

- Treating `5X` or `20X` as a quota calculator, billing amount, renewal state, or guaranteed message count.
- Hardcoding plan prices or replacing server-provided quota windows with marketing-tier assumptions.
- Displaying a raw token, account ID, cookie, session, full email, or original response in the UI, console, clipboard, or persistent storage.
- Displaying or persisting a manually entered Thread ID outside the temporary diagnostic input, automatically scanning thread history, or probing Thread Usage during ordinary refresh.
- Saving analytics rows, client aggregates, token totals, or usage history in `localStorage` or IndexedDB; analytics is memory-only.
- Requesting analytics once per day or once per range bucket; one requested range must not become a per-day request loop.
- Showing empty metric cards, fabricated percentages, or a gray “completed” bar when the source value is unknown.
- Making hover the only way to discover status, controls, or explanations.
- Destroying panel scroll position when the selected analytics range or loading state changes.
- Adding `totals` and top-level fields from the same API object instead of applying field-level fallback.
- Relying on the native `title` attribute as the only daily trend value display.
- Repeating official links or automatic-refresh settings in a bottom footer.
- Using a large primary “manual refresh” block that competes with account and quota data.
- Rendering the Analytics model-breakdown `credits` field as Credits, Token usage, or USD.
- Rendering hypothetical API-equivalent USD as an actual bill, real Credits, official quota, observed model-level Token attribution, or an unsupported complete total; silently treating absent days or unknown rates as zero.
- Copying Tokens, cookies, authorization values, account IDs, or raw responses into diagnostics.
- Building a custom calendar, adding a chart library, adding a remote dependency, or introducing a broad permission solely for visual polish.
- Depending only on `prefers-color-scheme`, creating a new host on each theme change, or attaching duplicate listeners during SPA navigation.
- Using thick borders, repeated cards, gradients, logo-like geometry, bounce animations, or unnecessary `!important` rules.
