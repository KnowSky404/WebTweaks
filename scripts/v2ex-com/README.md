# V2EX Conversation Enhancer

`conversation-enhancer.user.js` is a standalone Tampermonkey/Violentmonkey userscript for V2EX. It adds a conservative threaded view for cross-page replies, optional anonymous Imgur image uploads for genuine topic editors, and an accessible scroll-to-top button. The native V2EX reply list remains in the document as a fallback.

## Installation

Install Tampermonkey or Violentmonkey, then open the [raw userscript](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js). No package manager, build step, remote dependency, V2EX token, or V2EX login token is required by the script.

The script matches `https://v2ex.com/*` and `https://*.v2ex.com/*`. Thread reconstruction runs only on topic URLs such as `/t/123456`; the scroll button can run on other matched V2EX pages, and the uploader attaches only to recognized topic/reply textareas.

## Features

### Threaded replies

The script parses the rendered reply HTML, discovers actual V2EX pagination links, and fetches other pages from the current V2EX origin with same-origin credentials. A relationship is shown as:

- **exact** (`回复 #12`): the reply starts with one linked username and `#12`, the floor exists earlier, and its author matches the username;
- **inferred** (`推断回复`): one leading username has no floor number, so the reply is attached to the nearest earlier reply by that username;
- **unresolved** (`关系未确定`): an explicit floor is invalid, multiple leading users make the parent ambiguous, or no earlier matching author exists;
- **root**: no structural reply prefix was found.

V2EX does not expose a reliable public parent-reply identifier. Inferred relationships are therefore a heuristic, not a guarantee. Replies are never discarded when inference fails. The visual indentation is capped while the logical tree remains intact, and rendering uses an iterative stack so unusually deep content does not require recursive JavaScript calls.

For topics of up to 10 pages, the script loads the remaining pages automatically with at most three concurrent requests. A request has a timeout and may be retried once for a transient/network or 5xx failure. Progress is shown in the lower-right floating conversation panel, and partial failures leave the native list available. Topics over 10 pages are not fetched in full automatically; use `加载全部 N 页并构建楼中楼` when desired.

The `会话` control sits in a fixed lower-right dock above the `↑` scroll-to-top button. The panel is closed by default: the script sets `hidden = true`, `aria-expanded="false"`, and a scoped `.wt-v2ex-conversation-panel[hidden] { display:none !important; }` rule ensures that the CSS grid layout cannot override the hidden attribute. Clicking `会话` opens or closes the panel; Escape, an outside pointer click, and supported topic navigation close it as well. Opening and closing does not scroll the page, and the open state is not persisted.

The panel has exactly two view controls:

- **楼中楼**: shows the inferred hierarchy in a custom container. Every loaded child remains visible beneath its detected parent, including exact and inferred children; unresolved replies remain roots. Children are rendered iteratively with capped visual indentation and a guide line, with no per-branch state.
- **原始顺序**: hides the custom container and restores V2EX's untouched flat chronological reply list. The native floor, reply action, event behavior, and `aria-hidden` state are restored; switching views does not refetch or rebuild the threaded model.

Threaded replies reuse sanitized clones of V2EX's native `.cell` reply structure and `.reply_content`, so native typography, content elements, theme surfaces, and user CSS remain applicable. In each clone, the current native floor and reply controls are removed only from the cloned header using the verified selectors `.fr .no`, `.no`, `a.reply`, `.reply a`, and `[data-action="reply"]`, with empty `.reply`/`.fr` wrappers cleaned up. The live native reply cells are never modified.

Each threaded header ends with a compact right-aligned group containing the floor number followed by an icon-only reply button. The floor uses the parsed number, with `#?` only when unavailable; the reply button is a real keyboard-operable `<button type="button">` with an inline SVG (`.wt-v2ex-reply-icon`) and an `aria-label`. It inserts `@username #floor ` into the recognized editor. The relationship badge `回复 #12` remains relationship metadata and is distinct from this icon-only action. Threaded mode no longer provides an original-floor navigation action.

### Reply prefixes

The custom reply action inserts `@username #floor` at the current selection and focuses a supported reply editor. A delegated enhancement also observes a narrowly identified native reply action and lets V2EX's own handler run first, then adds a missing floor number when it can identify the source reply. It does not replace V2EX's native handler. If the current authenticated DOM does not expose a reliable native action, native behavior is left untouched.

### Imgur uploads

The uploader supports image paste, image drag-and-drop, and a file picker near the recognized reply or topic editor. It accepts only `image/*` MIME types and rejects files larger than 10 MiB before making a request. Files upload sequentially to `POST https://api.imgur.com/3/image` using the user's own Client ID and are inserted at the editor selection without submitting the form.

Reply editors receive a direct HTTPS image URL. A topic editor in detected Markdown mode receives `![image](https://...)`; when mode detection is uncertain, the direct URL is used. Existing text is preserved on failure, and ordinary text paste is not intercepted.

Configure the ID from the userscript menu command **设置 Imgur Client ID**. Register an Imgur API application, copy its **Client ID**, and enter only that value. **Do not enter or store a Client Secret, access token, Imgur password, V2EX password, or V2EX token.** No shared Client ID is bundled in this repository. **Imgur is a third-party service: anonymous upload is not private storage. Do not upload sensitive material.** WebTweaks does not provide Imgur deletion history or account management, and cannot control Imgur availability or rate limits.

If no Client ID is configured, the script shows an inline message and makes no upload request. A 401/403, 429, oversized image, timeout, network failure, server error, or malformed response is reported near the affected editor without clearing its contents. A transient network/5xx upload failure is retried once; 400, 401, 403, 413, and 429 are not automatically retried.

### Scroll to top

The shared lower-right dock contains the `会话` control on topic pages and the compact `↑` button below it. The scroll button appears after approximately 600 pixels of scrolling, uses a passive `requestAnimationFrame`-throttled scroll listener, supports keyboard activation, adapts on narrow screens, and uses instant scrolling when `prefers-reduced-motion: reduce` applies. On non-topic pages only the scroll button is present. Repeated initialization does not create another dock or button, and disabling scroll-to-top does not remove the conversation control.

## Settings and permissions

The following versioned settings are stored through the userscript manager only:

- preferred reply view;
- Imgur Client ID;
- uploader enabled state;
- scroll-to-top enabled state.

The conversation panel's open/closed state is not persisted. The menu also provides commands to clear the Client ID and switch the defaults. The metadata grants are limited to `GM_addStyle`, the manager value APIs, `GM_registerMenuCommand`, and `GM_xmlhttpRequest`; `@connect` is limited to `api.imgur.com`. The script has no `@require`, telemetry, remote configuration, credential collection, or shared secret.

## Known limitations and troubleshooting

- A reply containing only an ambiguous `@username` cannot guarantee a hierarchy; the UI marks that relationship inferred or unresolved rather than presenting it as fact.
- V2EX currently renders the public reply blocks as `#Main > div[id^="r_"].cell` with `.no`, `strong > a.dark[href^="/member/"]`, `.ago[title]`, `.reply_content`, and `.ps_container` pagination. These selectors may need maintenance after a V2EX redesign. Authenticated clone controls additionally use `.fr .no`, `.no`, `a.reply`, `.reply a`, and `[data-action="reply"]` within the cloned header only.
- Public anonymous pages do not expose the reply textarea, native reply button, or new-topic editor. The script uses defensive candidates (`#reply_content`, `#topic_content`, `textarea[name="content"]`) and only enhances a textarea in a form; authenticated editor behavior still needs browser verification.
- A topic with more than 10 pages is intentionally partial until the user starts the full load. If a page fails, switch to `原始顺序` to use the untouched native list.
- Imgur API availability, quotas, and returned links are outside WebTweaks' control. Retry by pasting, dropping, or selecting the image again.
- This version does not implement V2EX submission, moderation, thanks, Imgur OAuth, image compression, or anonymous-upload deletion history.

## 中文使用说明

安装脚本后打开 V2EX 主题页。工具栏中的“楼中楼”会读取当前主题的分页并重建会话关系；带有 `@用户 #楼层` 且作者匹配的是“精确”关系，不带楼层的单用户前缀只是“推断”关系，多用户或无效楼层会保留在顶层并标记“关系未确定”。超过 10 页的主题不会自动全部请求，点击“加载全部”后才会开始。

点击“上传图片”或直接把图片粘贴/拖到主题回复编辑器即可上传。首次使用前通过脚本菜单设置自己的 Imgur Client ID；只填 Client ID，不要填 Client Secret。每张图片上限 10 MiB，图片会发送给 Imgur，匿名上传不等于私密存储。上传失败不会清空编辑器，普通文字粘贴保持原生行为。

主题页右下角的“会话”按钮默认关闭会话面板，再次点击可切换开关；按 Escape 或点击面板外部也会关闭。面板只有“楼中楼”和“原始顺序”两个视图按钮，楼中楼中的所有子回复始终显示在父楼层下方，原始顺序保留 V2EX 原生的平铺回复、楼层和回复控件。线程头部使用“楼层 + 图标回复”组合，图标按钮仍会向编辑器插入 `@用户 #楼层 `。右下角面板下方的“↑”按钮默认在滚动约 600 像素后出现；非主题页只显示该返回顶部按钮。脚本菜单可分别关闭图片上传或返回顶部，也可切换默认的楼中楼/原始顺序。
