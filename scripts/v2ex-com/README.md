# V2EX Conversation Enhancer

`conversation-enhancer.user.js` is a standalone Tampermonkey/Violentmonkey userscript for V2EX. It adds a conservative threaded view for cross-page replies, browser-side image previews and a lightbox, and an accessible scroll-to-top button. The native V2EX reply list remains in the document as a fallback.

## Installation

Install Tampermonkey or Violentmonkey, then open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js). No package manager, build step, remote dependency, V2EX token, or V2EX login token is required by the script.

The script matches `https://v2ex.com/*` and `https://*.v2ex.com/*`. Thread reconstruction runs only on topic URLs such as `/t/123456`; the scroll button can run on other matched V2EX pages.

## Features

### Threaded replies

The script parses the rendered reply HTML, discovers actual V2EX pagination links, and fetches other pages from the current V2EX origin with same-origin credentials. Fetched pages extend the in-memory relationship dataset; they do not replace the active native page's rendering scope. A relationship is shown as:

- **exact** (`回复 #12`): the reply starts with one linked username and `#12`, the floor exists earlier, and its author matches the username;
- **inferred** (`推断回复`): one leading username has no floor number, so the reply is attached to the nearest earlier reply by that username;
- **unresolved** (`关系未确定`): an explicit floor is invalid, multiple leading users make the parent ambiguous, or no earlier matching author exists;
- **root**: no structural reply prefix was found.

V2EX does not expose a reliable public parent-reply identifier. Inferred relationships are therefore a heuristic, not a guarantee. Replies are never discarded when inference fails. The visual indentation is capped while the logical tree remains intact, and rendering uses an iterative stack so unusually deep content does not require recursive JavaScript calls.

For topics of up to 10 pages, the script loads the remaining pages automatically with at most three concurrent requests. A request has a timeout and may be retried once for a transient/network or 5xx failure. Progress is shown in the lower-right floating conversation panel, and partial failures leave the native list available. Topics over 10 pages are not fetched in full automatically; use `加载全部 N 页并构建楼中楼` when desired. In either case, threaded mode shows every reply from the active native page plus only the ancestor chain needed to explain cross-page relationships; unrelated earlier-page and future-page replies remain hidden.

The `会话` control sits in a fixed lower-right dock above the `↑` scroll-to-top button. The panel is closed by default: the script sets `hidden = true`, `aria-expanded="false"`, and a scoped `.wt-v2ex-conversation-panel[hidden] { display:none !important; }` rule ensures that the CSS grid layout cannot override the hidden attribute. Clicking `会话` opens or closes the panel; Escape, an outside pointer click, and supported topic navigation close it as well. Opening and closing does not scroll the page, and the open state is not persisted.

The panel has exactly two view controls:

- **楼中楼**: shows the inferred hierarchy in a custom container. All loaded pages contribute to relationship inference, while the visible projection contains every reply from the active native page plus only the required cross-page ancestors. Exact and inferred children appear beneath their detected parent; unresolved replies remain roots. Children are rendered iteratively with capped visual indentation and a guide line, with no per-branch state.
- **原始顺序**: hides the custom container and restores V2EX's untouched flat chronological reply list. The native floor, reply action, event behavior, and `aria-hidden` state are restored; switching views does not refetch or rebuild the threaded model.

Threaded replies reuse sanitized clones of V2EX's native `.cell` reply structure and `.reply_content`, so native typography, content elements, theme surfaces, and user CSS remain applicable. In each clone, the native reply control and floor are extracted only from the reply header's `.fr` group. Reply controls are identified by a scoped V2EX-owned `img[alt="Reply"]` or reply-asset filename, the existing `a.reply`/`.reply a`/`[data-action="reply"]` candidates, or a narrowly scoped native `replyOne(...)` handler; the live native reply cells are never modified.

Each threaded header ends with the preserved native reply arrow followed by the preserved native `.no` floor badge in a right-aligned `.fr` group. The original image source, dimensions, presentation classes, and native floor styling are retained; unsafe handlers and URLs are removed, and the action receives an accessible label plus reply data attributes. Its delegated click handler inserts `@username #floor ` into the recognized editor. When a fetched page has no reliable control template, the script reuses a safely captured current-page native template; it never invents a replacement SVG or plain-text floor. The relationship badge `回复 #12` remains relationship metadata and is distinct from the native action. Threaded mode no longer provides an original-floor navigation action.

### Reply prefixes

The preserved native-looking reply action inserts `@username #floor` at the current selection and focuses a supported reply editor. The threaded-view delegation prevents the detached clone's default navigation and reuses the existing prefix path; the separate native-page enhancement still lets V2EX's own handler run first. If the current authenticated DOM does not expose a reliable native action, native behavior is left untouched.

### Client-side image previews and lightbox

Topic and reply content is scanned locally for HTTP(S) image links ending in `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, or `.avif`, case-insensitively. Query strings and fragments are allowed because detection checks the parsed URL pathname. No HEAD request, content-type probe, iframe, or remote metadata request is made. SVG, HTML, data, blob, file, JavaScript, and unknown-extension URLs are not expanded.

The original URL or link remains in the V2EX content. WebTweaks inserts a lazy, asynchronously decoded `.wt-v2ex-inline-image` after it with `referrerpolicy="no-referrer"`. Initial scanning plus threaded-render and soft-navigation hooks cover topic content, native replies, threaded clones, and cross-page results; view switching reuses those already processed nodes. Per-link and per-container markers prevent duplicate previews, and a failed generated image is removed while its original link remains.

Clicking an image inside `.topic_content` or `.reply_content` opens a dependency-free fullscreen lightbox. This includes existing external images and generated previews, but excludes avatars and interface icons outside content. A supported image URL wrapping an existing thumbnail is used as its full-size source. Escape, the close button, or the overlay background closes it; keyboard activation, focus return, an original-image link, and exact background scroll-position restoration are supported. Ctrl, Cmd, Shift, and Alt clicks retain normal browser behavior.

Both features default to enabled and can be toggled with the userscript menu commands **开启/关闭评论图片自动展开** and **开启/关闭图片点击放大**.

Images are loaded directly from the original image host. WebTweaks does not track viewed images. V2EX server content is unchanged, and users without this script continue to see the original URL/content.

### Scroll to top

The shared lower-right dock contains the `会话` control on topic pages and the compact `↑` button below it. The scroll button appears after approximately 600 pixels of scrolling, uses a passive `requestAnimationFrame`-throttled scroll listener, supports keyboard activation, adapts on narrow screens, and uses instant scrolling when `prefers-reduced-motion: reduce` applies. On non-topic pages only the scroll button is present. Repeated initialization does not create another dock or button, and disabling scroll-to-top does not remove the conversation control.

## Settings and permissions

The following versioned settings are stored through the userscript manager only:

- preferred reply view;
- scroll-to-top enabled state;
- automatic comment image preview enabled state;
- image lightbox enabled state.

The conversation panel's open/closed state is not persisted. The metadata grants are limited to `GM_addStyle`, the manager value APIs, and `GM_registerMenuCommand`. The script has no `@require`, telemetry, remote configuration, credential collection, or cross-origin request permission.

## Maintainer validation

The page-projection regression fixture runs without a browser or external dependencies:

```bash
node scripts/v2ex-com/validate-threaded-projection.mjs
```

## Known limitations and troubleshooting

- A reply containing only an ambiguous `@username` cannot guarantee a hierarchy; the UI marks that relationship inferred or unresolved rather than presenting it as fact.
- V2EX currently renders the public reply blocks as `#Main > div[id^="r_"].cell` with `.no`, `strong > a.dark[href^="/member/"]`, `.ago[title]`, `.reply_content`, and `.ps_container` pagination. These selectors may need maintenance after a V2EX redesign. Threaded controls are extracted only from the reply header's `.fr` group using a V2EX-owned `img[alt="Reply"]` or reply-asset filename, the existing `a.reply`/`.reply a`/`[data-action="reply"]` candidates, and a native `replyOne(...)` handler fallback.
- Public anonymous pages do not expose the reply textarea or native reply button. The script uses defensive candidates (`#reply_content`, `#topic_content`, `textarea[name="content"]`) for reply-prefix behavior; authenticated editor behavior still needs browser verification.
- A topic with more than 10 pages is intentionally partial until the user starts the full load. If a page fails, switch to `原始顺序` to use the untouched native list.
- External preview availability, hotlink protection, CSP, and host-side blocking remain controlled by the original image host. Failed generated previews are removed and leave the original URL usable.
- This version does not implement V2EX submission, moderation, thanks, or image compression.

## 中文使用说明

安装脚本后打开 V2EX 主题页。工具栏中的“楼中楼”会读取当前主题的分页来重建会话关系，但显示范围仍以当前原生分页为准；当前页回复会保留，跨页时只补充解释这些回复所需的父级链路，不会把无关的前页或后页回复注入当前视图。带有 `@用户 #楼层` 且作者匹配的是“精确”关系，不带楼层的单用户前缀只是“推断”关系，多用户或无效楼层会保留在顶层并标记“关系未确定”。超过 10 页的主题不会自动全部请求，点击“加载全部”后才会开始。

回复或主题正文中的 HTTP(S) 图片链接会在浏览器侧自动展开，支持 JPG、JPEG、PNG、GIF、WebP 和 AVIF；原始链接与 V2EX 服务端内容不会被修改。点击正文图片可打开全屏预览，Escape、关闭按钮或点击遮罩空白处可以关闭，按住 Ctrl/Cmd/Shift/Alt 点击时保留浏览器原行为。图片直接由原始图片站点加载，WebTweaks 不跟踪查看记录。

主题页右下角的“会话”按钮默认关闭会话面板，再次点击可切换开关；按 Escape 或点击面板外部也会关闭。面板只有“楼中楼”和“原始顺序”两个视图按钮，楼中楼中的所有子回复始终显示在父楼层下方，原始顺序保留 V2EX 原生的平铺回复、楼层和回复控件。线程头部右侧复用 V2EX 原生的灰色回复箭头和 `.no` 楼层徽章，顺序为“回复箭头 + 楼层”，点击箭头仍会向编辑器插入 `@用户 #楼层 `。右下角面板下方的“↑”按钮默认在滚动约 600 像素后出现；非主题页只显示该返回顶部按钮。脚本菜单可分别关闭图片自动展开、点击放大或返回顶部，也可切换默认的楼中楼/原始顺序。
