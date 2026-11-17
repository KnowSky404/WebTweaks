# GitHub Page Tools

`page-tools.user.js` is a standalone GitHub userscript for Tampermonkey (primary) and compatible userscript managers. It needs no build, network permission, runtime dependency, or remote code.

## Installation

[Install or update the script](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/github-com/page-tools.user.js). Version **1.3.0** retains the three manager grants introduced in 1.1.0: `GM_registerMenuCommand`, `GM_unregisterMenuCommand`, and `GM_setClipboard`.

## Features

- **Scroll to top:** The original always-visible, accessible lower-right `↑` button, respecting reduced-motion settings.
- **Copy a file's direct Raw URL:** On repository code pages, right-click a file name or its row icon and choose **GitHub Page Tools → 复制右键文件的 Raw 链接**. The file-detail page still supports copying its native Raw link from the manager menu.
- **Copy Release downloads:** On **Releases**, **Release tag**, or **Latest Release** pages, right-click an uploaded asset (e.g. an installer or archive) and choose **GitHub Page Tools → 复制 Release 文件下载链接**. The same command accepts GitHub-generated **Source code (zip)** and **Source code (tar.gz)** entries.

Copied links always use `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<file>`, not `github.com/…/raw/…` redirect URLs. In file lists, the URL is derived from the targeted native `/blob/` file link (without altering its complete ref/path suffix); on file pages, GitHub's matching native Raw URL is normalized to the direct host. An explicit `refs/heads/…` or `refs/tags/…` form is preserved. Unqualified refs containing slashes may be ambiguous if GitHub's rendered link itself is ambiguous; the script deliberately avoids guessing ref boundaries.

## Release download links

GitHub Release assets are **not** repository Raw files. Uploaded assets use stable GitHub links such as:

```text
https://github.com/OWNER/REPO/releases/download/v1.0.0/app.zip
https://github.com/OWNER/REPO/releases/latest/download/app.zip
```

GitHub-generated source archives use GitHub archive URLs such as:

```text
https://github.com/OWNER/REPO/archive/refs/tags/v1.0.0.zip
https://github.com/OWNER/REPO/archive/refs/tags/v1.0.0.tar.gz
```

The script copies the **validated native `href`** (including a native query string) without following redirects or rewriting it to `raw.githubusercontent.com`. Final redirects to GitHub asset storage are not copied; such URLs may expire. Only HTTPS links under `github.com` for the **current repository** and recognized Release asset or source-archive patterns are accepted. The script does not fabricate a `latest/download` link when GitHub only provides a versioned download.

Right-clicking non-download links, a different repository's asset, or other page content clears the previous selection; no stale URL is copied. Private Release downloads can still require authentication; query-bearing URLs may contain sensitive authorization material, so treat copied links as credentials.

## Menu behavior

`GM_registerMenuCommand` registers **userscript-level** commands, not context entries scoped to individual DOM elements. The **Raw** command is registered on repository code pages, while the **Release download** command is registered on Release pages. The manager decides whether each command appears in Firefox/Chromium's native right-click menu or only in its toolbar popup; a command cannot be guaranteed to appear only on valid download links.

The script captures the most recent `contextmenu` event and validates the clicked link on invocation. It accepts one matching file or Release link from the current repository, including row icons outside the anchor. It rejects directories (`/tree/`), other repositories, untrusted hosts, removed or changed anchors, navigation to another URL, and selections older than 60 seconds. A new right-click elsewhere clears the selection. Firefox Shift+right-click may bypass the page event, so that gesture does not select a file. If no valid file is selected, nothing is copied and a message explains why. When using the manager toolbar rather than the browser context menu, first right-click the file to establish the selection.

On a file-detail page, the native Raw link remains a fallback for the popup command. When GitHub's validated native Raw link contains a temporary authentication query (such as `?token=…`), the script **preserves that query** when converting to `raw.githubusercontent.com` so private-file links remain usable as intended. **Treat copied token-bearing URLs as credentials**: do not share them publicly. Links may expire, and copying does not grant permanent public access. No file contents are read or transmitted.

## Permissions and validation

Metadata: `@match https://github.com/*`, `@noframes`, `GM_registerMenuCommand`, `GM_unregisterMenuCommand`, `GM_setClipboard`. No `@connect`, telemetry, `@require`, external requests, or tracking.

```sh
node --check scripts/github-com/page-tools.user.js
node --check scripts/github-com/validate-page-tools.mjs
node scripts/github-com/validate-page-tools.mjs
```

The dependency-free fixture checks right-clicked root/nested files, slash-containing refs, direct Raw URL formatting, Release asset downloads, latest/download URLs, source ZIP/TAR links, unsafe and cross-repository links, context invalidation, SPA navigation and command switching, repeated setup, clipboard errors, file-page fallback, preservation of synthetic private Raw query parameters, and reduced-motion scrolling. Simulated DOM tests are **not** live GitHub/Tampermonkey/Violentmonkey validation. Manually verify repository root and nested listing, file detail, Release list/tag/latest pages, uploaded assets and generated source archives, link copy/paste, navigation, light/dark themes, Firefox/Chromium and Tampermonkey's right-click/popup settings before merging.
