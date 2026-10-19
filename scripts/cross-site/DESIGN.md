# Browser Environment Spoofer V1 design

## Contract

The independently installable `browser-environment.user.js` changes selected JavaScript API results in eligible top-level HTTP(S) documents. Installation is inactive. Configuration stays in userscript-manager storage. There are no runtime dependencies, external resources, network calls, build artifacts, releases, or tags.

The explicit cross-site placement/matching exception is scoped by the [authoring guide](../../docs/SCRIPT_GUIDE.md). Existing website-specific scripts are unchanged. [README.md](README.md) is the user-facing source for setup, supported APIs, and limitations.

## Storage and resolution

`GM_getValue('wt-browser-environment:settings', null)` reads one versioned object synchronously, before installing overrides. A missing object produces these defaults:

```javascript
{
  version: 1,
  enabled: false,
  global: { enabled: false, environment: /* Los Angeles environment */ },
  sites: {}
}
```

Every environment has the following complete shape:

```javascript
{
  features: { language: true, timezone: true, geolocation: true },
  profile: {
    language: 'en-US',
    languages: ['en-US', 'en'],
    timezone: 'America/Los_Angeles',
    geolocation: { latitude: 34.0522, longitude: -118.2437, accuracy: 100 }
  }
}
```

Site keys must equal the canonical HTTP(S) `URL.origin` exactly. An entry is either `{ mode: 'disabled' }` or `{ mode: 'profile', environment }`. No entry means inheritance. Master off always resolves to native. Otherwise an explicit disabled entry takes precedence over a site profile, then global opt-in, then native. Paths and same-origin history navigation do not alter resolution.

Validation checks the entire schema, booleans, BCP 47 normalization, primary/preferred language agreement, IANA timezone validity, finite coordinates/ranges, and positive accuracy. Unknown versions and invalid objects produce inactive defaults plus a visible recovery message. There is no speculative migration. A settings save merges the current editor scope into the latest valid stored object, preserving other tabs' unrelated site entries, and checks synchronous readback. Reload is required; already-created objects and closures are never reconfigured live. Reset replaces all saved rules with defaults.

## Page execution and privilege boundary

The manager is responsible for `document-start` page injection. Tampermonkey receives `@sandbox raw`; Violentmonkey receives `@inject-into page`. `unsafeWindow` is used to compare Object/Function constructors and the navigator identity, and to read page diagnostics. If the realm comparison fails, no interception is installed. This deliberately avoids executing code in an isolated world and falsely reporting that the website changed.

In the supported raw/page path, GM functions and configuration handling remain in the manager's userscript closure. There is no persistent-configuration bridge, DOM event command channel, inline script injection, dynamic evaluation, or exported GM function. The only global marker is a non-writable symbolic initialization flag. UI writes require trusted input events. This is a convenience tool in a mutable webpage realm, not protection against a hostile page altering its own APIs or UI.

`raw` cannot guarantee injection under every CSP or manager configuration. If the manager cannot run the userscript at all, there can be no script-generated failure UI. If it runs in an unsupported world, its menu explains the failure. Earlier scripts, cached references, frames, Workers, and Service Workers remain outside the guarantee. The fixture's first inline script helps identify timing gaps.

## Interception and failure behavior

Each independent feature builds a list of descriptor replacements. A preflight requires every targeted descriptor to be configurable before changes begin. If a definition fails, previously changed descriptors in that group are restored in reverse order. Other groups continue. Diagnostics use `Installed` or `Not applied` per group, and list actual observed results separately.

Language interception replaces existing navigator getters, freezes the preferred-language array, and wraps `Intl.DateTimeFormat`, `Intl.NumberFormat`, and relevant Date/Number locale methods. Intl proxies forward native construction/calls, subclasses, prototypes, static methods, explicit locales, and options. Prototype constructor descriptors follow the installed wrapper. Other Intl constructors remain native.

Timezone interception layers over successful language interception. It only defaults an undefined timezone; a transparent options proxy preserves inherited/non-enumerable options and does not enumerate or eagerly evaluate getters. Fixed Gregorian/Latin-digit native Intl formatters obtain local calendar parts for the represented instant. Offset calculation compares those parts with native UTC getters, including calendar-day differences. It works at Date range endpoints without constructing an out-of-range shifted Date. Formatter construction is bounded; only the most recent timestamp's parts are cached.

Local Date getters/strings use those parts. Native timestamp progression, UTC getters/setters, `getTime`, ISO/JSON conversion, constructor identities, local constructors, parsing, and local setters remain intact. This V1 boundary avoids building a timezone-aware Date constructor/parser/setter polyfill with DST gap/fold disambiguation. Constructing a date from local fields can therefore differ from subsequently reading it in the selected timezone; this is disclosed in both the panel and README.

Geolocation interception requires an existing API in a secure context. A browser-exposed Permissions Policy denial prevents installation; unavailable policy inspection is reported rather than inferred. It never calls native geolocation or rewrites `navigator.permissions`. One-time and watch responses use cancellable, asynchronous timers and frozen position-like objects. Watch IDs are distinct from one-time requests, so `clearWatch` cannot cancel a one-time result. Static watches deliver once, then release callbacks and map entries. `pagehide` clears pending deliveries. The explicit diagnostic test retains the original installed simulation reference and refuses to call a page-replaced implementation.

## UI and diagnostics

The manager menu creates a single nonmodal panel in an open ShadowRoot. It uses DOM creation rather than HTML parsing, including under Trusted Types, and constructed stylesheets with a style-element fallback. Styles/classes are scoped and `wt-` prefixed. Light/dark themes, narrow viewports, labels, visible errors, panel-local Escape dismissal, and focus restoration are supported. No document-wide hotkey listener or periodic DOM scan is installed.

Diagnostics separate saved effective configuration, startup configuration, descriptor installation status, and page-observed language/Intl/Date values. Failed page-world access does not suppress the configured profile or substitute sandbox observations. Location begins as `Not tested`, never reads the native device location, and runs only on a trusted explicit test action. Unsupported signal categories and reload requirements stay visible.

## Validation sources

- `node --check scripts/cross-site/browser-environment.user.js` checks standalone syntax.
- `node --test scripts/cross-site/validate-browser-environment.mjs` runs focused native Node tests in isolated VM realms. Test instrumentation is added only to the test copy, never exposed by the distributed script.
- `verify-browser-environment.html` is an independently served webpage, not a userscript loader. Its earliest inline code and controls observe the page APIs and exercise Date invariants, explicit Intl arguments, geolocation cancellation, and navigation.
- Browser acceptance uses temporary Playwright tooling and fresh profiles outside the worktree. Manager acceptance installs the exact script through Tampermonkey's editor and opens the real registered menu. GM test doubles used for runtime-only Firefox/Chromium checks are explicitly distinct from actual manager tests.

See the [README compatibility matrix](README.md#execution-timing-and-browser-compatibility) for verified environments and untested manager combinations. Syntax/unit results do not establish cross-browser manager compatibility.

## V1 acceptance evidence

Validation was performed on 2026-10-19 using Node 24.16.0, Chromium 149, Firefox 151, and the actual Tampermonkey 5.5.1 extension. The Browser plugin was absent; existing host Playwright tooling and downloaded test browsers were used outside the repository.

| Requirement | Evidence / boundary |
| --- | --- |
| Installable standalone metadata, inactive defaults, no build/network dependency | Source/metadata tests; exact script installed through the real manager editor; fresh-page constructor references and native values unchanged. |
| Language and Intl locale | Native Node checks, both browser runtimes, and real manager page reads; explicit locales and subclass/prototype behavior preserved. |
| Default timezone and Date invariants | Winter/summer for all presets, both LA DST transitions, negative timestamps, year zero, Date range endpoints, explicit Intl timezone/options, UTC/time/ISO invariants. |
| Simulated geolocation and cancellation | One-time and concurrent static watches, asynchronous delivery, cancellation before/after delivery, no native location calls, pagehide cleanup, invalid callbacks/options, policy/API failure. Actual page fixture also exercises callbacks under the manager. |
| Persistent configuration and site/global scope | Actual menu save/reload, unrelated loopback origin remaining native, changed timezone, independent language switch, explicit global opt-in, site precedence, native exception, master disable, and reset. Retained settings read from manager Storage after full browser restart. |
| Diagnostics and failure handling | Actual page-world observations separate from configuration; unsupported-world/API tests; preflight/rollback tests; synthetic save events rejected; corrupt settings fail inactive. |
| CSP, UI, normal navigation | Chromium and Firefox runtime tests with restrictive CSP; Chromium Trusted Types; real Chromium/Tampermonkey CSP test with manager CSP header rewriting disabled; 1280px desktop and 390px dark mobile; page identity/content/console and ordinary navigation interactions checked. |
| Preservation and documentation | Existing V2EX regression command passes; existing `.user.js` files untouched; relative documentation links and canonical installation paths checked locally. No push, release, or tag is implied. |

The runtime matrix uses seven scenarios in each browser: native defaults, active profile, restrictive CSP, unsupported page world, absent geolocation API, policy header, and language disabled independently. Firefox lacks the tested policy inspection API and did not enforce the tested header even without the userscript; that baseline is not reported as script-enforced policy protection.

The sideloaded manager marked the manually installed script with its own unknown-origin/provenance warning after a browser restart. Stored configuration remained intact in its Storage UI. Automatic execution under that manager protection is **unverified**. Firefox/Tampermonkey and Violentmonkey installations are also unverified. Frame/Worker coverage and local Date construction/setter semantics are documented exclusions, not inferred successes.
