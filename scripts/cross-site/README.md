# Browser Environment Spoofer

**Default-disabled JavaScript environment customization for testing.** Version 1.0.0 is a readable, standalone userscript with no build, runtime dependencies, backend, or network requests. It changes selected values exposed to the top-level webpage. It does not change the operating system, browser settings, network location, or provide anonymity.

中文：安装后默认关闭。从脚本管理器菜单打开设置，开启主开关，选择当前站点使用配置，保存并刷新。下方说明列出了实际支持的 API、兼容性与限制。

## Installation and configuration

Install Tampermonkey, open the [canonical raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/cross-site/browser-environment.user.js), and confirm installation. Violentmonkey page injection is also targeted; see the verification matrix below.

1. Open an eligible HTTP(S) webpage and choose **Browser Environment Spoofer — Settings** in the userscript manager menu. No floating control is added.
2. Turn on **Enable environment overrides (master)**. Under **Current origin**, select **Use this profile**.
3. Choose Los Angeles, Shanghai, Tokyo, or Custom. Edit the primary language, comma-separated preferred languages, IANA timezone, coordinates, and accuracy. The first preferred language must equal the primary language. Preset coordinates represent cities, not the actual device.
4. Set the three independent feature switches, then **Save settings** and **Reload now**. Changes do not reconfigure an already-running page.

All values are validated before storage. Blank/invalid coordinates, malformed language tags, invalid IANA zones, wrong types, or malformed stored structures are rejected. Unknown schema versions or corrupted settings disable overrides and show a recovery message; **Reset all saved rules** replaces them with inactive defaults. Storage failures are displayed without claiming a successful save.

**Restore native on this site** saves an explicit native exception, including when a global default is enabled. Reload to restore native APIs. Turning the master switch off disables every rule after reload. Reset removes all saved rules and turns both master and global activation off.

## Exact origin rules

A site is an exact `URL.origin`: scheme, hostname, and effective port, with no path. `https://example.test`, `http://example.test`, `https://sub.example.test`, and `https://example.test:8443` are separate sites. Paths and same-origin SPA navigation share a rule. Subdomains are not implicitly included; there is no substring matching.

With the master switch on, resolution is:

1. Explicitly disabled origin → native environment.
2. Origin-specific profile → that profile and its feature switches.
3. Explicitly enabled global default → global profile and switches.
4. Otherwise → native environment.

To enable global mode, select **Global default**, check **Apply global default on all eligible sites**, save, and reload affected pages. This control is off initially and displays a warning that overrides may break applications. A site profile replaces the entire global profile; disabled features in that site profile stay native.

## Supported JavaScript signals

| Feature | Supported behavior |
| --- | --- |
| Language | `navigator.language`, frozen `navigator.languages`, and legacy `userLanguage`/`browserLanguage`/`systemLanguage` only if already present. |
| Default locale | `Intl.DateTimeFormat`, `Intl.NumberFormat`, Date's three `toLocale*` methods, and `Number.prototype.toLocaleString`. Omitted/undefined locales and empty locale arrays use the profile. Explicit locales retain native behavior, including native locale fallback. |
| Default timezone | `Intl.DateTimeFormat` and Date's `toLocaleString`, `toLocaleDateString`, and `toLocaleTimeString`. Explicit `timeZone` options, inherited options, and option accessors are preserved. |
| Local Date readings | `getTimezoneOffset`, `getFullYear`, `getMonth`, `getDate`, `getDay`, `getHours`, `getMinutes`, `getSeconds`, legacy `getYear`, `toString`, `toDateString`, and `toTimeString`. Offsets use the represented timestamp and the browser's IANA rules, including DST. |
| Simulated geolocation | Asynchronous `getCurrentPosition` and `watchPosition`, unique watch IDs, immediate `clearWatch` cancellation, independent concurrent watches, and a single initial notification for a static location. Position-like readonly objects include nullable fields, timestamp, and `toJSON`. No real location request is made. |

`Date.now()`, Date timestamps, `getTime`, `valueOf`, `toISOString`, `toJSON`, UTC getters/setters, and the Date constructor/prototype identities remain native. Intl constructors support ordinary calls, `new`, subclasses, `instanceof`, `supportedLocalesOf`, and explicit arguments.

**Date boundary:** local multi-argument constructors, parsing strings without explicit offsets, `Date.parse`, local setters, and calling `Date()` as a function retain the **host timezone**. Use timestamps, UTC setters, or ISO strings with explicit offsets when working with the configured timezone. Implementing a complete local-time construction/setter engine would require ambiguous DST disambiguation and a much larger compatibility surface. Local getters and formatting are intentionally the V1 boundary. String formatting resembles native Date output but does not promise identical platform-specific timezone names. Historical timezone accuracy follows the browser's Intl database; GMT string suffixes have minute precision.

Other Intl constructors and implicit locale operations such as `String.prototype.localeCompare` are not overridden. Geolocation responses are plain position-like objects, not branded native `GeolocationPosition` instances; movement, sensor acquisition, `enableHighAccuracy`, `maximumAge`, and timeout simulation are not implemented. A static watch releases its callback after the initial delivery; cancellation before delivery removes its timer. Page teardown clears pending callbacks.

## Execution, timing, and browser compatibility

The script requests `document-start`, Tampermonkey `@sandbox raw`, and Violentmonkey `@inject-into page`, with synchronous GM storage. A shared-object/constructor check verifies that the executing code can see the webpage's JavaScript realm. If that check fails, every override is skipped and settings report that page-world observations are unavailable. API descriptor failures roll back only the affected feature group and are reported individually. There is no inline/eval injection fallback, CSP rewriting, remote code, or page event bridge.

`raw` is a request, not a universal main-world guarantee. The manager can fall back to another world, or fail to inject at all. If no userscript executes, its menu cannot appear; check the manager's execution/host-access settings. The script cannot detect page code that ran before it or change cached native references retroactively.

Tampermonkey's ordinary content-script/message-based modes can run after the first page script. For earlier execution, use **Settings → Config mode: Advanced → Content Script API: UserScripts API Dynamic**, then save the Security section. Enable the browser's **Allow User Scripts** extension control where required. Do not weaken the website's CSP. Firefox's supported UserScripts API modes differ; check the linked manager documentation. A script can still run too late in some configurations.

In the temporary sideloaded Chromium/Tampermonkey test profile, a full browser restart triggered Tampermonkey's own **“origin of this script can't be determined”** protection on the manually installed script. Manager storage still retained the saved configuration. Automatic execution after that protected restart was not verified; follow the manager's review/save instruction for a script you trust. This is distinct from page-world access or settings validation failures, and the script does not disable that protection.

| Environment | Verification |
| --- | --- |
| Chromium 149 + Tampermonkey 5.5.1 | Actual extension installation, menu, GM storage, reloads, page API observations, and retained storage across restart exercised. Protected restart auto-execution has the limitation above. Detailed results are recorded in [DESIGN.md](DESIGN.md). |
| Chromium 149 / Firefox 151 page runtimes | Actual page API and UI tests using test doubles for GM storage/menu; these prove core browser behavior, not userscript-manager timing. |
| Firefox + Tampermonkey | Targeted by the metadata and fail-closed realm check; actual manager installation/injection not exercised. |
| Violentmonkey | Targeted via explicit page injection and legacy synchronous GM APIs; actual manager installation/injection not exercised. CSP may block page injection entirely. |

Coverage is deliberately **top-level documents only** (`@noframes`). Same-origin and cross-origin iframes, `about:blank`/`srcdoc` frames, Web Workers, and Service Workers retain their native environments. Websites may obtain native values through those contexts. Browser-internal pages, extension pages, and file URLs are outside the matching rules.

## Geolocation policy and privacy

The script does not create geolocation on insecure/unsupported pages. It respects blocking Permissions Policy when the browser exposes a policy inspection API; diagnostics state when inspection is unavailable. In the tested Firefox runtime, the policy inspection API was unavailable and the tested geolocation policy header was also not enforced by the native browser. No policy support beyond the browser's own implementation is claimed.

`navigator.permissions.query`, permission prompts, and browser permission settings are unchanged. Simulated callbacks can therefore disagree with a permission state such as `prompt` or `denied`; they do not grant sensor access. The settings panel's location test only invokes the installed simulation, after an explicit click, and refuses the test if the page replaced that API.

Only `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`, and `unsafeWindow` are requested. GM storage stays local to the manager and survives browser restarts. No settings, coordinates, or browsing data are uploaded or automatically exported. The page can observe the selected values and recognize interception. Synthetic page events cannot save settings; persistence actions require trusted UI events. A hostile page can tamper with its own realm or imitate UI, so this is not an adversarial security boundary.

HTTP `Accept-Language`, browser UI/OS language, public IP/egress country, HTTP/TLS/network fingerprints, User-Agent, Client Hints, WebRTC, postal/account information, and server-side geolocation are unchanged. This tool does not proxy traffic, bypass browser security, or promise a fully consistent fingerprint.

## Verification

Open **Page diagnostics** to compare the saved effective profile, the rule at this document's startup, individual installation results, and actual page-context API reads. A saved profile is never treated as proof that interception worked. Geolocation initially says **Not tested**; click **Test simulated location** explicitly. **Refresh observations** reads current APIs without changing storage. A reload reminder separates saved settings from the running page.

From the repository root:

```sh
node --check scripts/cross-site/browser-environment.user.js
node --test scripts/cross-site/validate-browser-environment.mjs
```

The native Node tests instrument an isolated VM copy of the distributed source; the production userscript exposes no test API. They cover strict validation, presets, exact-origin precedence, corrupt settings, language normalization, explicit Intl arguments, winter/summer and DST transition offsets, timestamp invariants, independent toggles, rollback, unsupported worlds/APIs, asynchronous geolocation, watcher cancellation, and repeated initialization.

The [verification fixture](verify-browser-environment.html) reads the **website's own** APIs, including the earliest inline page script, explicit locale/timezone arguments, Date invariants, one-time geolocation, watcher cancellation, and same-origin navigation. It does not install or inject the userscript. Serve it over HTTP(S), install the userscript in the browser, enable that fixture origin, and reload. For example, `python3 -m http.server 8662 --bind ::` from this repository serves it. On this VPS the remote URL is `http://oc-de-fra-1.knowsky.uk:8662/scripts/cross-site/verify-browser-environment.html`; that public HTTP origin is not a secure context, so use HTTPS or run the fixture locally on the browser's machine for geolocation tests. Close the server when finished.

Actual browser checks used temporary Playwright tooling outside this repository because the Browser plugin was unavailable. No package manifest, test framework, or browser dependency was added to WebTweaks. Unit tests and syntax checks alone do not prove manager compatibility.

## References

- [Tampermonkey sandbox, grants, storage, menu, timing, and Content Script API](https://www.tampermonkey.net/documentation.php)
- [Violentmonkey page injection and document-start limits](https://violentmonkey.github.io/api/metadata-block/)
- [MDN Navigator](https://developer.mozilla.org/en-US/docs/Web/API/Navigator), [Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl), [Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date), and [Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
