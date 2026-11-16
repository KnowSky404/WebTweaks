# GitHub Page Tools

`page-tools.user.js` is a standalone Tampermonkey/Violentmonkey userscript for `https://github.com/*`.

## Installation

Open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/github-com/page-tools.user.js) in your userscript manager. No build, external script, account token, or cross-origin permission is required. When updating from v1.0.0, approve the newly required userscript-manager menu and clipboard grants.

## Features

- **Scroll to top:** An always-visible, keyboard-accessible `↑` button at the bottom-right of GitHub pages. It scrolls to the top and respects reduced-motion preferences.
- **Copy Raw URL:** On repository file (`/blob/`) pages with a recognized native **Raw** link, use the userscript manager's **GitHub Page Tools → 复制当前文件的 Raw 链接** menu command. The browser's right-click context menu can expose it when supported and enabled by the userscript manager; alternatively, open the Tampermonkey/Violentmonkey toolbar popup and select the script's command. The script no longer adds a button to GitHub's file toolbar.

The copied value is the **URL** from GitHub's rendered **Raw** link, not file contents. It is not synthesized from the address bar: refs (including branch names containing `/`), tags, and commits can use different path forms. For safety, the script accepts only HTTPS Raw links from GitHub domains for the currently viewed repository/file. If a trusted Raw link is missing, the menu command is not registered; if it disappears between menu display and selection, no URL is copied and the script reports the problem. GitHub soft navigation and asynchronous Raw toolbar changes are watched to add/remove the command without duplicates.

The manager controls the exact menu placement and whether commands appear in the browser's context menu. A multi-level custom submenu cannot be guaranteed across browsers/managers. Private-repository Raw links may need authentication or expire; copying a link does not make it public.

## Permissions and limitations

The metadata grants only `GM_registerMenuCommand`, `GM_unregisterMenuCommand`, and `GM_setClipboard`, and excludes frames with `@noframes`. Clipboard writes use the manager's privileged API, so the browser Clipboard API permission is not needed. There are no cross-origin requests, external dependencies, telemetry, or file-content reads. A synchronous clipboard error is shown; a manager that does not report an asynchronous failure cannot be verified by this script.

GitHub may change its file-toolbar markup or use a Raw URL format that cannot be matched against the current file path. In that case, the menu action is omitted rather than copying an unverified URL. The scroll button remains visible at the top of a page.

## Validation

Run the dependency-free syntax and simulated DOM checks:

```sh
node --check scripts/github-com/page-tools.user.js
node --check scripts/github-com/validate-page-tools.mjs
node scripts/github-com/validate-page-tools.mjs
```

The simulated checks cover manager menu lifecycle, duplicate registration, exact Raw URL clipboard writes, slash-containing refs, soft navigation, async toolbar changes, stale or invalid Raw links, clipboard errors, and reduced-motion scrolling. These fixtures do **not** establish live compatibility with GitHub's DOM or actual Tampermonkey/Violentmonkey context-menu and clipboard implementations. Manually test a public and private file page (if available), branches/tags/commits, directory/issue pages, soft navigation, light/dark mode, Firefox/Chromium, and the relevant manager settings. Confirm the command appears in the toolbar popup even when the browser's right-click menu integration is disabled.
