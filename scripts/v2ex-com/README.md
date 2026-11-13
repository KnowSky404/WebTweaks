# V2EX Conversation Enhancer

`conversation-enhancer.user.js` is a standalone Tampermonkey/Violentmonkey userscript for V2EX. It adds a conservative threaded view for cross-page replies, reply thanks and their counts, browser-side image previews and a lightbox, and an accessible scroll-to-top button. The native V2EX reply list remains in the document as a fallback.

## Installation

Install Tampermonkey or Violentmonkey, then open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js). No package manager, build step, remote dependency, or manually supplied V2EX API/login token is required. Sending thanks uses the existing signed-in page session and its current request token.

The script matches `https://v2ex.com/*` and `https://*.v2ex.com/*`. Thread reconstruction runs only on topic URLs such as `/t/123456`; settings and the optional scroll button are available on all matched V2EX pages.

## Features

### Threaded replies

The script parses the rendered reply HTML, discovers actual V2EX pagination links, and fetches other pages from the current V2EX origin with same-origin credentials. Fetched pages extend the in-memory relationship dataset; they do not replace the active native page's rendering scope. A relationship is shown as:

- **exact** (`回复 #12`): the reply starts with one linked username and `#12`, the floor exists earlier, and its author matches the username;
- **inferred** (`推断回复`): one leading username has no floor number, so the reply is attached to the nearest earlier reply by that username;
- **unresolved** (`关系未确定`): an explicit floor is invalid, multiple leading users make the parent ambiguous, or no earlier matching author exists;
- **root**: no structural reply prefix was found.

V2EX does not expose a reliable public parent-reply identifier. Inferred relationships are therefore a heuristic, not a guarantee. Replies are never discarded when inference fails. The visual indentation is capped while the logical tree remains intact, and rendering uses an iterative stack so unusually deep content does not require recursive JavaScript calls.

For topics of up to 10 pages, the script loads the remaining pages automatically with at most three concurrent requests. These read-only page requests have a timeout and may be retried once for a transient/network or 5xx failure. Progress is shown in the lower-right settings panel, and partial failures leave the native list available. Topics over 10 pages are not fetched in full automatically; use `加载全部 N 页并构建楼中楼` when desired. In either case, threaded mode shows every reply from the active native page plus only the ancestor chain needed to explain cross-page relationships; unrelated earlier-page and future-page replies remain hidden. History API topic transitions carry a monotonic revision, so a delayed load from an older page cannot become current again after a rapid return to the same URL.

The lower-right `设置` entry opens a single, non-modal settings panel, available even when scroll-to-top is disabled. It is closed by default and closes with Escape, an outside click, focus leaving the dock, or topic navigation. Opening focuses its first available control without scrolling; Escape returns focus to the settings button. The open state is not persisted. The panel fits narrow viewports and supports light/dark themes.

Its **会话视图** section appears only when a topic has usable replies, with loading status, the optional full-page loading action, and two mutually exclusive view choices:

- **楼中楼**: shows the inferred hierarchy in a custom container. All loaded pages contribute to relationship inference, while the visible projection contains every reply from the active native page plus only the required cross-page ancestors. Exact and inferred children appear beneath their detected parent; unresolved replies remain roots. Children are rendered iteratively with capped visual indentation and a guide line, with no per-branch state.
- **原始顺序**: hides the custom container and restores V2EX's flat chronological reply list. The native floor, reply action, event behavior, and `aria-hidden` state are restored; switching views does not refetch or rebuild the threaded model. Confirmed thanks state is synchronized between the two views.

Threaded replies reuse sanitized clones of V2EX's native `.cell` and `.reply_content`. Public HTML inspected on 2026-11-13 uses a `.flex-one-row` header with separate author/badges/time/count and action/floor groups. The script keeps that structure and the native `.no` floor element in its original position; older `.fr` groups remain supported. Previously, `.fr`-only extraction failed on the new header, and cleanup deleted the surviving floor before inserting an empty legacy group.

Each reply supplies its own controls. Recognition uses V2EX-owned reply image assets, native action classes, or a narrowly inspected `replyOne(...)` handler within the header. Sanitized clones preserve native classes, image sources/dimensions, text, wrappers, and spacing. Delegation inserts `@username #floor ` into the editor with focus, selection, and an input event. No reply action or floor is borrowed from another reply or fabricated from an ID. Unrecognized controls remain unavailable, and an untrustworthy floor is omitted. Original mode keeps V2EX's own handlers unchanged. Relationship labels remain separate from native controls.

New native replies are merged by ID and projected into the existing hierarchy. A list-scoped observer also detects V2EX's current `#topic-replies.replaceChildren(...)` refresh, including replacement of its inner `.box`, and rebuilds the disposed model using existing navigation guards. Empty topic lists can initialize when the first native reply arrives. No submission is intercepted, no phantom reply is generated, and no polling is used.

### Reply thanks

Version 1.7.0 preserves V2EX's native presentation and spacing: each reply's sanitized `.small.fade` count and original heart `img` retain their source position, and the action/completed state use `thank_area`, `a.thank`, and `thanked` with the page's own styling. Hidden recovery controls add no extra whitespace to the normal thanks action. The cloned outer reply table also retains V2EX's fixed layout, whose native selector requires an `r_` ID that clones intentionally omit. Completion displays **感谢已发送**. No emoji replacement or custom button decoration is added; Flex headers wrap only when needed within indented/narrow replies; keyboard and touch support only adapt visibility and activation. An unreadable count remains unknown rather than becoming zero. A positive total count does not mean that the current user has already thanked the reply.

Direct thanks is limited to replies on the active native page. The script requires a matching native `thank_area_<reply-id>` control, the page's native thanks capability, and a valid current request token. It asks for confirmation before sending: [V2EX charges 10 copper coins for thanking a reply](https://www.v2ex.com/help/currency). Cancelling sends nothing. A confirmed action makes one same-origin request for that real reply ID; the script does not use floor numbers as request IDs or automatically retry a write.

Successful responses update the threaded model and corresponding native thanks area, and ask V2EX to refresh its displayed balance. A targeted read of the source page refreshes the count. Business failures display a message and allow a deliberate retry when a valid current token is available. Network failures, timeouts, or unrecognized responses leave the result unconfirmed; **核对状态** performs only a read. If that read still shows a usable thanks action, the result remains unconfirmed and the script does not send another request. An uncertain token, a missing replacement token, or a response from an old lifecycle blocks reuse of that sent token for this document; another direct send requires a fresh valid page token or a reload. Use the original page to resolve the uncertainty before retrying.

Cross-page ancestors retain their own count and already-thanked state. When the ancestor's source markup exposes a valid thanks action, **到原页感谢** opens its actual source page, selects the native view, and locates/focuses the target reply's control, including topics over 10 pages. Background page loading preserves that choice until the user explicitly switches views. This version does not send thanks for cross-page ancestors in place. Anonymous pages, the user's own replies, and unmatched markup do not acquire a fabricated action. If the active page's bridge or token is unavailable, use the native view instead.

Thanks state survives threaded redraws and is synchronized when switching views. Only one enhanced thanks write runs at a time. Confirmed and uncertain results are remembered for the specific topic/reply during this document's lifetime, including soft navigation back to that reply; a late failure cannot undo confirmed thanks, and old responses do not overwrite the new page's token or unrelated native controls. This does not prevent an independent native-page action from running concurrently. Controls remain available to keyboard and touch users without requiring hover.

### Hide replies

Version 1.7.0 restores V2EX's native **隐藏** control when the active-page reply itself exposes a recognized `ignoreReply(replyId, token)` action. Both standalone controls and hide links sharing a native thanks area are supported. Clones keep the original caption/classes while stripping inline handlers and tokens. Activation asks for confirmation, then rechecks the live reply ID, token, action identity, page lifecycle, and native page capability before calling V2EX's own helper once. Cancelled, stale, duplicate, unrecognized, or unavailable actions send nothing. Cross-page ancestors and replies without their own capability do not gain a hide action.

Hiding suppresses the selected reply's own header/content in both views and retains its child discussion. Hidden state survives redraws and soft navigation for this document. Original-view hiding remains native and is reflected when switching views. V2EX's helper hides optimistically and exposes no server result; WebTweaks does not claim server confirmation or retry automatically. Account persistence after reload depends on V2EX accepting its native request.

### Reply prefixes

The preserved native-looking reply action inserts `@username #floor` at the current selection and focuses a supported reply editor. The threaded-view delegation prevents the detached clone's default navigation and reuses the existing prefix path. Original mode leaves the native action unchanged. If the current authenticated DOM does not expose a reliable native action, native behavior is left untouched.

### Client-side image previews and lightbox

Topic and reply content is scanned locally for HTTP(S) image links ending in `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, or `.avif`, case-insensitively. Query strings and fragments are allowed because detection checks the parsed URL pathname. No HEAD request, content-type probe, iframe, or remote metadata request is made. SVG, HTML, data, blob, file, JavaScript, and unknown-extension URLs are not expanded.

The original URL or link remains in the V2EX content. WebTweaks inserts a lazy, asynchronously decoded `.wt-v2ex-inline-image` after it with `referrerpolicy="no-referrer"`. Initial scanning plus threaded-render and soft-navigation hooks cover topic content, native replies, threaded clones, and cross-page results; view switching reuses those already processed nodes. Per-link and per-container markers prevent duplicate previews, and a failed generated image is removed while its original link remains.

Clicking an image inside `.topic_content` or `.reply_content` opens a dependency-free fullscreen lightbox. This includes existing external images and generated previews, but excludes avatars and interface icons outside content. A supported image URL wrapping an existing thumbnail is used as its full-size source. Escape, the close button, or the overlay background closes it; keyboard activation, focus return, an original-image link, and exact background scroll-position restoration are supported. Ctrl, Cmd, Shift, and Alt clicks retain normal browser behavior.

Both features default to enabled. The settings panel’s **图片增强** group has **评论图片自动展开** and **图片点击放大** switches. Disabling previews removes only generated images and leaves original links; disabling the lightbox removes only attributes owned by WebTweaks. Repeated toggles apply immediately without duplicating listeners or images.

Images are loaded directly from the original image host. WebTweaks does not track viewed images. V2EX server content is unchanged, and users without this script continue to see the original URL/content.

### Scroll to top

The shared lower-right dock contains `设置` and the independent `↑` button. When enabled, scroll-to-top stays visible at every scroll position, including the page top, and respects reduced motion. It needs no scroll listener or visibility threshold. The **页面工具 → 返回顶部** switch applies immediately. Disabling it leaves settings accessible on topic and non-topic pages.

## Settings and permissions

The following versioned settings are stored through the userscript manager only:

- preferred reply view;
- scroll-to-top enabled state;
- automatic comment image preview enabled state;
- image lightbox enabled state.

The panel reuses the existing `wt-v2ex-settings` GM storage and version-3 keys without resetting preferences. Feature menu commands and the unused `GM_registerMenuCommand` grant have been removed. The panel's open/closed state is not persisted. The metadata grants are `GM_addStyle`, the manager value APIs, and `unsafeWindow`. The last permission is used narrowly for the native thanks bridge/token/balance and to invoke `ignoreReply` with the current reply’s own live token. Ignore tokens are neither copied into rendered clones nor persisted. The token is used only for the current V2EX origin and is never persisted or logged. The script has no `@require`, telemetry, remote configuration, or cross-origin request permission. Updating to version 1.5.0 may require accepting this added page-context permission in the userscript manager.

## Maintainer validation

The dependency-free checks cover syntax, active-page replacement, required cross-page ancestors, duplicate rendering, rapid page 1 → page 2 → page 1 switching, delayed callback rejection, original-view restoration, and thanks state handling:

```bash
node --check scripts/v2ex-com/conversation-enhancer.user.js
node scripts/v2ex-com/validate-threaded-projection.mjs
node scripts/v2ex-com/validate-reply-thanks.mjs
```

The thanks regression checks use simulated requests and page state. The browser fixture compares native and threaded computed control styles, image attributes, dimensions, spacing, and fixed table layout, and checks nested control wrappers and unchanged content metadata. It also covers Flex and legacy headers, membership badges, pagination, rendered thanks controls, confirmation cancellation, response handling, state synchronization, cross-page fallback, unified settings, immediate feature toggles, and native append/list-replacement updates. Serve the repository root over HTTP, open `scripts/v2ex-com/validate-browser-regressions.html`, and run the checks shown on the page. These fixtures do not send real thanks or spend coins.

Fixture results are separate from authenticated V2EX verification. Real signed-in thanks, userscript page-context access, and Tampermonkey/Violentmonkey behavior on Chromium and Firefox still require target-environment validation. Check one intentional thanks, cancellation, already-thanked/own-reply states, view switching, and the cross-page source link; do not treat mocked responses as proof of live-site compatibility.

## Known limitations and troubleshooting

- A reply containing only an ambiguous `@username` cannot guarantee a hierarchy; the UI marks that relationship inferred or unresolved rather than presenting it as fact.
- Current public HTML uses `.cell[id^="r_"]` inside `#topic-replies .box`, with a Flex header and `.no`, `strong > a.dark[href^="/member/"]`, `.ago[title]`, `.reply_content`, and `.ps_container` pagination. These selectors may need maintenance after another redesign. Authenticated controls remain conservatively detected from each reply's own header; unknown markup fails closed.
- Public anonymous pages do not expose the reply textarea or native reply button. The script uses defensive candidates (`#reply_content`, `#topic_content`, `textarea[name="content"]`) for reply-prefix behavior; authenticated editor behavior still needs browser verification.
- A topic with more than 10 pages is intentionally partial until the user starts the full load. If a page fails, switch to `原始顺序` to use the native list.
- External preview availability, hotlink protection, CSP, and host-side blocking remain controlled by the original image host. Failed generated previews are removed and leave the original URL usable.
- Direct reply thanks requires recognized native controls and current page-context access. Unknown outcomes are never silently retried. Cross-page ancestors use their source-page thanks link.
- This version does not implement V2EX submission, moderation, topic thanks, or image compression.

## 中文使用说明

安装脚本后打开 V2EX 主题页。工具栏中的“楼中楼”会读取当前主题的分页来重建会话关系，但显示范围仍以当前原生分页为准；当前页回复会保留，跨页时只补充解释这些回复所需的父级链路，不会把无关的前页或后页回复注入当前视图。带有 `@用户 #楼层` 且作者匹配的是“精确”关系，不带楼层的单用户前缀只是“推断”关系，多用户或无效楼层会保留在顶层并标记“关系未确定”。超过 10 页的主题不会自动全部请求，点击“加载全部”后才会开始。

1.6.0 适配新版 Flex 回复头部，并兼容旧版 `.fr` 结构；修复旧清理流程删除楼层后无法补回的问题。控件只取自该条回复自身，不再借用其他回复的模板。进一步保留原生控件结构与间距：感谢区域、回复箭头和楼层徽章保留原有顺序及包裹元素，感谢数量回到该回复原来的位置，不再统一重排。隐藏的核对控件不会给正常感谢入口增加空白，并补回克隆回复因移除 ID 而丢失的原生固定表格布局；楼中楼层级继续保留。当前页回复具有自己的原生感谢入口时，确认消耗 10 铜币后发送；取消确认不会发送。成功后同步显示原生文案“感谢已发送”。网络超时或结果不明确时不会自动重发，“核对状态”只重新读取来源页；如果仍无法确认成功，会保留未确认状态。跨页祖先只显示它自己的数量和状态，有原生感谢入口时提供“到原页感谢”，本版本不支持跨页原地送心。未登录、自己的回复或无法识别的原生控件不会生成可用的感谢操作。

1.5.0 新增 `unsafeWindow` 权限，用于访问当前页面的感谢能力和实时请求令牌；脚本不会要求手动填写 Token，也不会持久化或记录令牌。若脚本管理器提示更新权限，需接受后才能使用增强视图的感谢功能。真实登录态和 Tampermonkey/Violentmonkey 的兼容性应按上面的验收步骤检查。

回复或主题正文中的 HTTP(S) 图片链接会在浏览器侧自动展开，支持 JPG、JPEG、PNG、GIF、WebP 和 AVIF；原始链接与 V2EX 服务端内容不会被修改。点击正文图片可打开全屏预览，Escape、关闭按钮或点击遮罩空白处可以关闭，按住 Ctrl/Cmd/Shift/Alt 点击时保留浏览器原行为。图片直接由原始图片站点加载，WebTweaks 不跟踪查看记录。

所有匹配页面右下角统一使用“设置”入口，面板默认关闭；Escape、点击外部或主题导航均可关闭，Escape 会把焦点还给设置按钮。主题页的“会话视图”提供互斥的“楼中楼 / 原始顺序”、分页加载状态与手动加载按钮；非主题页隐藏不可用的会话操作。“图片增强”包含“评论图片自动展开 / 图片点击放大”，“页面工具”包含“返回顶部”，均即时生效并沿用原有 GM 偏好。关闭返回顶部仍可打开设置，不再提供重复的脚本菜单开关。异步提交后新增或整体刷新回复列表时，会按当前分页更新线程，不接管提交或生成虚构回复。

1.7.0 恢复回复旁边原生的“隐藏”：只对当前页具有自身原生入口的回复开放，确认后调用网站原生功能；取消不发送，隐藏父回复时保留其下的讨论。隐藏状态在本次文档的重绘和软导航中保留，但原生接口不返回服务端结果，刷新后是否持久生效取决于网站请求是否成功。返回顶部开启后始终展示，位于页首也不再自动隐藏；仍可在设置中关闭。
