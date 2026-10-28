# V2EX Conversation Enhancer

`conversation-enhancer.user.js` is a standalone Tampermonkey/Violentmonkey userscript for V2EX. It adds a conservative threaded view for cross-page replies, reply thanks and their counts, browser-side image previews and a lightbox, and an accessible scroll-to-top button. The native V2EX reply list remains in the document as a fallback.

## Installation

Install Tampermonkey or Violentmonkey, then open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js). No package manager, build step, remote dependency, or manually supplied V2EX API/login token is required. Sending thanks uses the existing signed-in page session and its current request token.

The script matches `https://v2ex.com/*` and `https://*.v2ex.com/*`. Thread reconstruction runs only on topic URLs such as `/t/123456`; the scroll button can run on other matched V2EX pages.

## Features

### Threaded replies

The script parses the rendered reply HTML, discovers actual V2EX pagination links, and fetches other pages from the current V2EX origin with same-origin credentials. Fetched pages extend the in-memory relationship dataset; they do not replace the active native page's rendering scope. A relationship is shown as:

- **exact** (`回复 #12`): the reply starts with one linked username and `#12`, the floor exists earlier, and its author matches the username;
- **inferred** (`推断回复`): one leading username has no floor number, so the reply is attached to the nearest earlier reply by that username;
- **unresolved** (`关系未确定`): an explicit floor is invalid, multiple leading users make the parent ambiguous, or no earlier matching author exists;
- **root**: no structural reply prefix was found.

V2EX does not expose a reliable public parent-reply identifier. Inferred relationships are therefore a heuristic, not a guarantee. Replies are never discarded when inference fails. The visual indentation is capped while the logical tree remains intact, and rendering uses an iterative stack so unusually deep content does not require recursive JavaScript calls.

For topics of up to 10 pages, the script loads the remaining pages automatically with at most three concurrent requests. These read-only page requests have a timeout and may be retried once for a transient/network or 5xx failure. Progress is shown in the lower-right floating conversation panel, and partial failures leave the native list available. Topics over 10 pages are not fetched in full automatically; use `加载全部 N 页并构建楼中楼` when desired. In either case, threaded mode shows every reply from the active native page plus only the ancestor chain needed to explain cross-page relationships; unrelated earlier-page and future-page replies remain hidden. History API topic transitions carry a monotonic revision, so a delayed load from an older page cannot become current again after a rapid return to the same URL.

The `会话` control sits in a fixed lower-right dock above the `↑` scroll-to-top button. The panel is closed by default: the script sets `hidden = true`, `aria-expanded="false"`, and a scoped `.wt-v2ex-conversation-panel[hidden] { display:none !important; }` rule ensures that the CSS grid layout cannot override the hidden attribute. Clicking `会话` opens or closes the panel; Escape, an outside pointer click, and supported topic navigation close it as well. Opening and closing does not scroll the page, and the open state is not persisted.

The panel has exactly two view controls:

- **楼中楼**: shows the inferred hierarchy in a custom container. All loaded pages contribute to relationship inference, while the visible projection contains every reply from the active native page plus only the required cross-page ancestors. Exact and inferred children appear beneath their detected parent; unresolved replies remain roots. Children are rendered iteratively with capped visual indentation and a guide line, with no per-branch state.
- **原始顺序**: hides the custom container and restores V2EX's flat chronological reply list. The native floor, reply action, event behavior, and `aria-hidden` state are restored; switching views does not refetch or rebuild the threaded model. Confirmed thanks state is synchronized between the two views.

Threaded replies reuse sanitized clones of V2EX's native `.cell` reply structure and `.reply_content`, so native typography, content elements, theme surfaces, and user CSS remain applicable. In each clone, the native reply control and floor are extracted only from the reply header's `.fr` group. Reply controls are identified by a scoped V2EX-owned `img[alt="Reply"]` or reply-asset filename, the existing `a.reply`/`.reply a`/`[data-action="reply"]` candidates, or a narrowly scoped native `replyOne(...)` handler; cloning does not move or rewrite the live native reply cells. A confirmed thanks action updates its corresponding native thanks state.

Each threaded header ends with the preserved native reply arrow followed by the preserved native `.no` floor badge in a right-aligned `.fr` group. The original image source, dimensions, presentation classes, and native floor styling are retained; unsafe handlers and URLs are removed, and the action receives an accessible label plus reply data attributes. Its delegated click handler inserts `@username #floor ` into the recognized editor. When a fetched page has no reliable reply control template, the script reuses a safely captured current-page native template; it never invents a replacement SVG or plain-text floor. Thanks controls are built separately from each reply's own metadata and never inherit another reply's permissions or identity. The relationship badge `回复 #12` remains relationship metadata and is distinct from the native action. Original-page navigation is offered only as a thanks fallback, not as a general jump-to-floor control.

### Reply thanks

Threaded headers show the reply's parsed heart count and, when supported by its own native state, a **感谢** action or **已感谢** feedback. An unreadable count remains unknown rather than becoming zero. A positive total count does not mean that the current user has already thanked the reply.

Direct thanks is limited to replies on the active native page. The script requires a matching native `thank_area_<reply-id>` control, the page's native thanks capability, and a valid current request token. It asks for confirmation before sending: [V2EX charges 10 copper coins for thanking a reply](https://www.v2ex.com/help/currency). Cancelling sends nothing. A confirmed action makes one same-origin request for that real reply ID; the script does not use floor numbers as request IDs or automatically retry a write.

Successful responses update the threaded model and corresponding native thanks area, and ask V2EX to refresh its displayed balance. A targeted read of the source page refreshes the count. Business failures display a message and allow a deliberate retry when a valid current token is available. Network failures, timeouts, or unrecognized responses leave the result unconfirmed; **核对状态** performs only a read. If that read still shows a usable thanks action, the result remains unconfirmed and the script does not send another request. An uncertain token, a missing replacement token, or a response from an old lifecycle blocks reuse of that sent token for this document; another direct send requires a fresh valid page token or a reload. Use the original page to resolve the uncertainty before retrying.

Cross-page ancestors retain their own count and already-thanked state. When the ancestor's source markup exposes a valid thanks action, **到原页感谢** opens its actual source page, selects the native view, and locates/focuses the target reply's control, including topics over 10 pages. Background page loading preserves that choice until the user explicitly switches views. This version does not send thanks for cross-page ancestors in place. Anonymous pages, the user's own replies, and unmatched markup do not acquire a fabricated action. If the active page's bridge or token is unavailable, use the native view instead.

Thanks state survives threaded redraws and is synchronized when switching views. Only one enhanced thanks write runs at a time. Confirmed and uncertain results are remembered for the specific topic/reply during this document's lifetime, including soft navigation back to that reply; a late failure cannot undo confirmed thanks, and old responses do not overwrite the new page's token or unrelated native controls. This does not prevent an independent native-page action from running concurrently. Controls remain available to keyboard and touch users without requiring hover.

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

The conversation panel's open/closed state is not persisted. The metadata grants are `GM_addStyle`, the manager value APIs, `GM_registerMenuCommand`, and `unsafeWindow`. The last permission is used narrowly to check the page's native thanks capability, read/update its live `once` request token, and refresh the native balance after success. The token is used only for the current V2EX origin and is never persisted or logged. The script has no `@require`, telemetry, remote configuration, or cross-origin request permission. Updating to version 1.5.0 may require accepting this added page-context permission in the userscript manager.

## Maintainer validation

The dependency-free checks cover syntax, active-page replacement, required cross-page ancestors, duplicate rendering, rapid page 1 → page 2 → page 1 switching, delayed callback rejection, original-view restoration, and thanks state handling:

```bash
node --check scripts/v2ex-com/conversation-enhancer.user.js
node scripts/v2ex-com/validate-threaded-projection.mjs
node scripts/v2ex-com/validate-reply-thanks.mjs
```

The thanks regression checks use simulated requests and page state. The browser fixture extends the pagination checks with rendered thanks controls, confirmation cancellation, response handling, state synchronization, and cross-page fallback. Serve the repository root over HTTP, open `scripts/v2ex-com/validate-browser-regressions.html`, and run the checks shown on the page. These fixtures do not send real thanks or spend coins.

Fixture results are separate from authenticated V2EX verification. Real signed-in thanks, userscript page-context access, and Tampermonkey/Violentmonkey behavior on Chromium and Firefox still require target-environment validation. Check one intentional thanks, cancellation, already-thanked/own-reply states, view switching, and the cross-page source link; do not treat mocked responses as proof of live-site compatibility.

## Known limitations and troubleshooting

- A reply containing only an ambiguous `@username` cannot guarantee a hierarchy; the UI marks that relationship inferred or unresolved rather than presenting it as fact.
- V2EX currently renders the public reply blocks as `#Main > div[id^="r_"].cell` with `.no`, `strong > a.dark[href^="/member/"]`, `.ago[title]`, `.reply_content`, and `.ps_container` pagination. These selectors may need maintenance after a V2EX redesign. Threaded controls are extracted only from the reply header's `.fr` group using a V2EX-owned `img[alt="Reply"]` or reply-asset filename, the existing `a.reply`/`.reply a`/`[data-action="reply"]` candidates, and a native `replyOne(...)` handler fallback.
- Public anonymous pages do not expose the reply textarea or native reply button. The script uses defensive candidates (`#reply_content`, `#topic_content`, `textarea[name="content"]`) for reply-prefix behavior; authenticated editor behavior still needs browser verification.
- A topic with more than 10 pages is intentionally partial until the user starts the full load. If a page fails, switch to `原始顺序` to use the native list.
- External preview availability, hotlink protection, CSP, and host-side blocking remain controlled by the original image host. Failed generated previews are removed and leave the original URL usable.
- Direct reply thanks requires recognized native controls and current page-context access. Unknown outcomes are never silently retried. Cross-page ancestors use their source-page thanks link.
- This version does not implement V2EX submission, moderation, topic thanks, or image compression.

## 中文使用说明

安装脚本后打开 V2EX 主题页。工具栏中的“楼中楼”会读取当前主题的分页来重建会话关系，但显示范围仍以当前原生分页为准；当前页回复会保留，跨页时只补充解释这些回复所需的父级链路，不会把无关的前页或后页回复注入当前视图。带有 `@用户 #楼层` 且作者匹配的是“精确”关系，不带楼层的单用户前缀只是“推断”关系，多用户或无效楼层会保留在顶层并标记“关系未确定”。超过 10 页的主题不会自动全部请求，点击“加载全部”后才会开始。

楼中楼会显示能可靠读取的爱心数量。当前页回复具有自己的原生感谢入口时，可以点击“感谢”，确认消耗 10 铜币后发送；取消确认不会发送。成功后同步显示“已感谢”，并更新原生感谢状态。网络超时或结果不明确时不会自动重发，“核对状态”只重新读取来源页；如果仍无法确认成功，会保留未确认状态。跨页祖先只显示它自己的数量和状态，有原生感谢入口时提供“到原页感谢”，本版本不支持跨页原地送心。未登录、自己的回复或无法识别的原生控件不会生成可用的感谢操作。

1.5.0 新增 `unsafeWindow` 权限，用于访问当前页面的感谢能力和实时请求令牌；脚本不会要求手动填写 Token，也不会持久化或记录令牌。若脚本管理器提示更新权限，需接受后才能使用增强视图的感谢功能。真实登录态和 Tampermonkey/Violentmonkey 的兼容性应按上面的验收步骤检查。

回复或主题正文中的 HTTP(S) 图片链接会在浏览器侧自动展开，支持 JPG、JPEG、PNG、GIF、WebP 和 AVIF；原始链接与 V2EX 服务端内容不会被修改。点击正文图片可打开全屏预览，Escape、关闭按钮或点击遮罩空白处可以关闭，按住 Ctrl/Cmd/Shift/Alt 点击时保留浏览器原行为。图片直接由原始图片站点加载，WebTweaks 不跟踪查看记录。

主题页右下角的“会话”按钮默认关闭会话面板，再次点击可切换开关；按 Escape 或点击面板外部也会关闭。面板只有“楼中楼”和“原始顺序”两个视图按钮，楼中楼中的所有子回复始终显示在父楼层下方，原始顺序保留 V2EX 原生的平铺回复、楼层和回复控件。线程头部右侧复用 V2EX 原生的灰色回复箭头和 `.no` 楼层徽章，顺序为“回复箭头 + 楼层”，点击箭头仍会向编辑器插入 `@用户 #楼层 `。右下角面板下方的“↑”按钮默认在滚动约 600 像素后出现；非主题页只显示该返回顶部按钮。脚本菜单可分别关闭图片自动展开、点击放大或返回顶部，也可切换默认的楼中楼/原始顺序。
