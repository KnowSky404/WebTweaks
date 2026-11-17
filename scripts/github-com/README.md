# GitHub Page Tools

`page-tools.user.js` is a standalone GitHub userscript for Tampermonkey (primary) and compatible userscript managers. It needs no build, network permission, runtime dependency, or remote code.

## Installation

[Install or update the script](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/github-com/page-tools.user.js). Version **1.2.1** retains the three manager grants introduced in 1.1.0: `GM_registerMenuCommand`, `GM_unregisterMenuCommand`, and `GM_setClipboard`.

## Features

- **Scroll to top:** The original always-visible, accessible lower-right `↑` button, respecting reduced-motion settings.
- **Copy a file's direct Raw URL:** In a repository root or folder listing, **right-click a file name or its row icon**, then select **GitHub Page Tools → 复制右键文件的 Raw 链接** from Tampermonkey's context menu. You do **not** need to open the file. The script also preserves copying from a file-detail page through the manager's menu, using GitHub's native Raw link.

Copied links always use `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<file>`, not `github.com/…/raw/…` redirect URLs. In file lists, the URL is derived from the targeted native `/blob/` file link (without altering its complete ref/path suffix); on file pages, GitHub's matching native Raw URL is normalized to the direct host. An explicit `refs/heads/…` or `refs/tags/…` form is preserved. Unqualified refs containing slashes may be ambiguous if GitHub's rendered link itself is ambiguous; the script deliberately avoids guessing ref boundaries.

## Menu behavior

`GM_registerMenuCommand` registers a **userscript-level** command, not a context entry scoped to one DOM element. The command is registered on repository code pages; whether it appears in Firefox/Chromium's native right-click menu or only the userscript-manager popup is controlled by the manager and browser. It cannot be guaranteed to appear *only* on valid file links.

The script captures the most recent `contextmenu` event and validates the clicked link on invocation. It accepts one file link in the current repository, including row icons outside the anchor. It rejects directories (`/tree/`), other repositories, untrusted hosts, removed or changed anchors, navigation to another URL, and selections older than 60 seconds. A new right-click elsewhere clears the selection. Firefox Shift+right-click may bypass the page event, so that gesture does not select a file. If no valid file is selected, nothing is copied and a message explains why. When using the manager toolbar rather than the browser context menu, first right-click the file to establish the selection.

On a file-detail page, the native Raw link remains a fallback for the popup command. When GitHub's validated native Raw link contains a temporary authentication query (such as `?token=…`), the script **preserves that query** when converting to `raw.githubusercontent.com` so private-file links remain usable as intended. **Treat copied token-bearing URLs as credentials**: do not share them publicly. Links may expire, and copying does not grant permanent public access. No file contents are read or transmitted.

## Permissions and validation

Metadata: `@match https://github.com/*`, `@noframes`, `GM_registerMenuCommand`, `GM_unregisterMenuCommand`, `GM_setClipboard`. No `@connect`, telemetry, `@require`, external requests, or tracking.

```sh
node --check scripts/github-com/page-tools.user.js
node --check scripts/github-com/validate-page-tools.mjs
node scripts/github-com/validate-page-tools.mjs
```

The dependency-free fixture checks right-clicked root/nested files, slash-containing refs, direct Raw URL formatting, unsafe and directory links, context invalidation, SPA navigation, repeated setup, clipboard errors, file-page fallback, preservation of synthetic private Raw query parameters, and reduced-motion scrolling. Simulated DOM tests are **not** live GitHub/Tampermonkey/Violentmonkey validation. Manually verify repository root and nested listing, files/directories, file detail, light/dark themes, Firefox/Chromium and Tampermonkey's right-click/popup settings before merging.
