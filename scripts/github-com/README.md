# GitHub Page Tools

`page-tools.user.js` is a standalone Tampermonkey/Violentmonkey userscript for `https://github.com/*`.

## Installation

Open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/github-com/page-tools.user.js) in your userscript manager. No build, external script, account token, or cross-origin permission is required.

## Features

- **Scroll to top:** An always-visible, keyboard-accessible `↑` button at the bottom-right of GitHub pages. It scrolls the main page to the top and respects the browser's reduced-motion setting.
- **Copy Raw URL:** A **Copy Raw URL** button next to GitHub's own **Raw** link on standard repository file (`/blob/`) pages. It copies the URL exposed by that link, not the file contents. GitHub's built-in **Copy raw contents** control copies text instead of a URL.

The Raw URL is taken from GitHub's rendered file toolbar rather than reconstructed from the address bar. This avoids misparsing branch names that contain `/`, tags, and commit references. The button is omitted if a trustworthy Raw link is unavailable. The script also handles GitHub soft navigation and asynchronously rendered file toolbars without duplicating controls. Private-repository Raw links may require authentication or expire, so do not assume a copied URL is publicly accessible.

## Permissions and limitations

The script uses `@grant none` and the native Clipboard API. Copying requires browser clipboard support and permission; if the write fails, the button reports failure rather than claiming success. No file content is read, downloaded, or transmitted by WebTweaks. No telemetry, third-party requests, or remote dependencies are used.

GitHub can change its file-toolbar markup. If the original Raw link cannot be reliably identified, the copy button is intentionally not shown. The scroll button currently remains visible even at the top of a page.

## Validation

Run the dependency-free syntax and simulated DOM checks:

```sh
node --check scripts/github-com/page-tools.user.js
node scripts/github-com/validate-page-tools.mjs
```

The simulated checks cover exact link copying (including slash-containing branch names), soft navigation, duplicate-control avoidance, invalid Raw URLs, and reduced-motion scrolling. They do not establish compatibility with GitHub's live DOM or userscript-manager clipboard privileges. Before merging, manually check a public and private repository if available, a branch/tag/commit file view, a directory and issue page, soft navigation, clipboard success/failure, light/dark themes, Firefox/Chromium, and Tampermonkey/Violentmonkey as applicable.
