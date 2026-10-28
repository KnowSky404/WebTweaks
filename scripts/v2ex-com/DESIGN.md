# V2EX Conversation Enhancer Design

## Scope and verified DOM

This is one readable, independently installable userscript. It does not import a framework, package, sanitizer, or hosted runtime. Public V2EX HTML was inspected on 2026-08-18 and its pagination structure was rechecked on 2026-09-02 using:

- `https://www.v2ex.com/t/1234938` (public topic replies);
- `https://www.v2ex.com/t/1234095?p=2` (page 2 of a multi-page topic);
- `https://www.v2ex.com/t/939486?p=1` and `?p=2` (ordinary pagination links and disjoint native reply pages);
- `https://www.v2ex.com/new` (redirected to sign-in in the unauthenticated environment).

The current public reply structure is `#Main > div[id^="r_"].cell` with `id="r_<reply-id>"`. Within it, `.no` contains the floor, `strong > a.dark[href^="/member/"]` identifies the author, `img.avatar` identifies the avatar, `.ago[title]` contains the source timestamp, and `.reply_content` contains rendered content. The current source selector map is:

```javascript
reply: ['#Main .cell[id^="r_"]', '#Wrapper .cell[id^="r_"]', '.cell[id^="r_"]']
replyContent: ['.reply_content']
replyAuthor: ['strong a.dark', 'strong a[href^="/member/"]']
replyAvatar: ['img.avatar']
replyFloor: ['.no']
replyTime: ['.ago']
replyThanks: ['.small.fade img[alt="❤️"]']
nativeReplyFloor: ['.fr .no', '.no']
pagination: ['.ps_container a[href*="?p="]', '.ps_container a[href*="&p="]']
pageInput: ['.ps_container input.page_input']
editor: ['#reply_content', '#topic_content', 'textarea[name="content"]']
nativeReplyAction: ['a.reply', '.reply a', '[data-action="reply"]']
```

Pagination is in `.cell.ps_container`, with `.page_current`, `.page_normal`, `.page_input`, and ordinary links containing `?p=`. Native V2EX pagination therefore performs a document navigation; History API hooks remain a defensive soft-navigation path. The URL `p` parameter is the single source of truth for the active page, while `topic.currentPage` and `topic.navigationRevision` snapshot the page and navigation generation for one topic lifecycle. Rendering never infers or writes the page from the custom DOM, and it never rewrites the native pagination controls. The public pages did not expose authenticated reply actions or editors; those selectors remain defensive. For authenticated reply controls, extraction is scoped to the reply header's `.fr` group. The implementation checks a V2EX-owned `img[alt="Reply"]` or reply-asset filename, then the existing action selectors, and finally clickable elements whose original `onclick` or `href` contains `replyOne(...)`. It never searches for reply images page-wide.

For soft navigation, the native `.page_current` marker is used only as a DOM-readiness check, never as page state. If History changes before V2EX replaces the reply list, synchronization waits up to two seconds for the native DOM to match the URL snapshot. The temporary observer disconnects after success, timeout, or another navigation, preventing an old page DOM from being parsed under a new page key. A timeout removes the stale custom topic UI and leaves the native page untouched rather than binding the old reply DOM to the new URL.

Reply-thanks behavior was inspected on 2026-10-28 through [V2EX's public JavaScript bundle](https://www.v2ex.com/assets/59f307c984101a2d28ff6b4081507694a69c3114-combo.js?t=1793153400) and [currency documentation](https://www.v2ex.com/help/currency). The bundle's `thankReply(replyId)` posts to `/thank/reply/<reply-id>?once=<current-token>`, replaces the native `thank_area_<reply-id>` contents on success, updates the page's `once`, and calls `refreshMoney()`. It does not return the request or update the displayed heart count. Public anonymous HTML exposes counts but no authenticated thanks action. These observations justify the narrow adapter below; they do not establish authenticated userscript compatibility, which still needs live-site validation.

## Shared floating dock and panel lifecycle

`ensureControlDock` creates one `#wt-v2ex-control-dock` with class `wt-v2ex-control-dock`. On topic pages it contains, in order, the conversation panel, the `会话` toggle, and the `wt-v2ex-scroll-top` button. On other V2EX pages it contains only the scroll button when that setting is enabled. The dock uses the lower-right safe area; the panel is positioned above the toggle and has a narrow-screen width cap.

The conversation panel is a non-modal, keyboard-operable region. `createConversationControl` initializes it with `panel.hidden = true`, the toggle with `aria-expanded="false"`, and an accessible label for opening the panel. `setConversationPanelOpen` keeps `hidden`, `aria-expanded`, and the open/closed accessible label synchronized. The panel is closed by a second `会话` click, Escape, an outside `pointerdown`, or supported topic navigation. Its state is not persisted in `GM_setValue`; only the preferred view is stored. Opening and closing does not scroll the page.

The grid layout has an intentionally component-scoped hidden override:

```css
.wt-v2ex-conversation-panel[hidden] {
  display: none !important;
}
```

This fixes the conflict in which `.wt-v2ex-conversation-panel { display:grid; }` could otherwise override the browser's hidden-attribute presentation. The override is limited to this userscript component rather than changing all `[hidden]` elements on V2EX.

The panel contains only the `会话视图` title, the two view buttons `楼中楼` and `原始顺序`, the conditional full-page-load button, and the live status region. There are no branch-operation controls.

## Reply model and parsing

Every parsed reply retains:

```text
id, floor, page, author, normalizedAuthor, avatarUrl, timeText,
contentHtml, contentText, thankCount, thanks, mentionedUsers,
normalizedMentions, explicitReplyFloor,
hasMultipleStructuralMentions, hasStructuralMention,
parentId, relationshipConfidence, unresolvedReason, children,
nativeTemplate, nativeReplyControlsTemplate
```

Header presentation was rechecked on 2026-10-28 against the public HTML at `https://www.v2ex.com/t/1153000` and its linked combined stylesheet. In particular, V2EX applies `table-layout:fixed` through an `r_` ID selector, while the thanks/count/reply classes supply their native presentation.

`nativeTemplate` is a sanitized clone of the current-page or fetched native reply element. The live current-page element is never moved or mutated during cloning. Fetched HTML is parsed into a detached `Document`, cloned, and sanitized before import into the live page.

Native IDs are removed from the template root and descendants. The original identity is retained in reply data and `data-wt-v2ex-reply-id` for duplicate protection and narrowly scoped thanks actions; no duplicate `r_*` or `thank_area_*` ID is inserted. The reply's source page is used for targeted state reads and the cross-page thanks fallback. It is not used to restore a general jump-to-floor feature.

Thanks metadata is captured before clone cleanup and remains separate from `nativeReplyControlsTemplate`. It distinguishes a parsed count from an unknown count, the reply's own native action capability, its already-thanked state, and the operation phase/message. A native `thank_area_<numeric-id>` and the action's parsed `thankReply(<same-id>)` must refer to that exact reply outside its content. Handler strings are inspected only for identity; they are never evaluated or copied into the enhanced controls. An anonymous page's request token is insufficient evidence that any reply can be thanked.

## Relationship inference and page-scoped projection

The existing relationship model remains intentionally conservative. Exact `@username #floor` relationships require an earlier floor and matching author. A single username without a floor is inferred from the nearest earlier reply by that author. Multiple mentions, invalid floors, and missing earlier authors remain unresolved roots. `topic.allReplies` is the relationship dataset: it contains the current native page and every successfully fetched page. `inferRelationships(topic.allReplies)` sorts that global dataset by floor and preserves each real `parentId` and `children` relationship, including parents on another page.

`deriveVisibleThread(topic)` is a separate rendering projection. It starts with every reply whose `reply.page` equals `topic.currentPage`, walks each `parentId` chain with cycle protection, and adds only those ancestors to `visibleIds`. It then builds `childrenByParent` and visible roots without mutating the global relationships. Thus unrelated earlier-page roots and replies from future pages remain outside the threaded view even after their pages have been fetched. Root ordering follows the first active-page descendant so cross-page context does not move the visible sequence back to the beginning of an earlier page.

`renderThreadedView` consumes the page-scoped `visibleThread` topology and uses a fresh `Set` of reply IDs for every render. Before a model is emitted, its ID is checked; a duplicate is skipped with the existing log prefix and a warning. Normal data produces no warning. When the threaded view is visible, a reply-ID viewport anchor is captured and restored after a background rebuild when that reply still exists, avoiding an unnecessary scroll jump. Switching views updates visibility and synchronizes thanks state without rebuilding the tree, duplicating clones, refetching pages, or adding listeners. Pagination rebuilds the one custom container after merging global relationship data and deriving the active-page projection; confirmed or pending thanks state is retained rather than reconstructed from the old sanitized template.

## Native reply visibility and original mode

The native reply cells remain in the DOM for fallback. When the custom view is selected, `applyTopicView` adds `wt-v2ex-native-hidden` and `aria-hidden="true"` to each native reply. When `原始顺序` is selected, it removes both the class and `aria-hidden`, and the native list is shown again.

The source uses these targeted selectors:

```css
#Main .cell[id^="r_"].wt-v2ex-native-hidden,
#Wrapper .cell[id^="r_"].wt-v2ex-native-hidden {
  display: none !important;
}
```

They use `display: none !important` only for this third-party native-reply visibility override. The native nodes remain in the DOM for fallback. Original mode therefore retains V2EX's native floor, reply action, chronological ordering, and event behavior; clone-only cleanup never changes those live cells. After a confirmed thanks response, the corresponding native thanks area is updated to the same completed state so switching views does not offer the action again.

## Native-template threaded rendering

The threaded renderer clones the sanitized native `.cell` and adds no separate reply surface. It preserves the native table, avatar, author, metadata, `.reply_content`, and content descendants so V2EX theme CSS and user CSS continue to control typography and surfaces. The renderer does not set a reply font family, font size, weight, text alignment, white-space, or line height, and does not impose a separate reply background, border, radius, or card padding.

`sanitizeReplyTemplate` removes scripts, styles, forms, form controls, embedded documents, duplicate IDs, inline event attributes, unsafe URLs, and raw native action controls, including thanks. Safe links are normalized against their source document; external links receive `rel="noopener noreferrer"`, and images are lazy-loaded. The clone is detached from the original live reply and has no duplicate `id="r_*"`. Thanks is then reconstructed from narrowly captured reply metadata with explicit event handling; enabling it does not permit arbitrary original handlers or unrelated moderation actions to survive cleanup.

Before sanitization, the recognized native control group and header heart count are replaced with inert slots in the detached reply template. `createReplyCard` fills those slots after the native header nodes have been wrapped in `wt-v2ex-reply-header`, keeping the source positions relative to `.sep3`, author, badges, and timestamp. A scoped fallback removes any remaining header floor/action candidates. The separately extracted control group retains only the recognized reply action, floor, and an inert thanks-area slot, their wrappers, and original whitespace; unrelated native actions are discarded. These operations are applied only inside the clone. A `.small.fade` span in reply content is not removed by header cleanup.

Hierarchy styling is limited to the prefixed threaded parent, child indentation, a guide line, a six-level visual cap, relationship markers, and narrow-screen sizing. The one native layout equivalent, `.wt-v2ex-threaded-reply > table { table-layout:fixed; }`, restores V2EX's `.cell[id^=r_] > table` rule after duplicate IDs have been removed. Reply-header layout and thanks appearance otherwise use V2EX's styles. The logical tree remains deeper than six levels. Child containers are always appended and remain visible; they have no per-branch visibility or expanded/collapsed state.

## Header actions

Preserve the native appearance of reply counts, thanks actions, reply arrows, and floors. Reuse V2EX's own nodes, image assets, and classes instead of adding a replacement visual design; restrict adaptations to the structure, state, and accessibility needed by the threaded view.

`createReplyCard` locates the native reply content cell and wraps the native header nodes before `.sep5` in the scoped `wt-v2ex-reply-header`. The verified header area includes the native floor, member link, badges, and `.ago` timestamp. Before cleanup, `parseReply` captures the reply's native `.fr` control group into `nativeReplyControlsTemplate`.

The rendered right-side `.fr.wt-v2ex-native-reply-controls` group contains the native thanks area, sanitized reply anchor/image, and native `.no` floor badge. The reply arrow remains before the floor. V2EX's `.fr` layout is retained; version 1.5.1 removes the flex header rearrangement and custom thanks borders, padding, colors, focus decoration, and opacity rules. Inline handlers, duplicate IDs, unsafe URLs, and stateful data attributes are removed from detached controls. The delegated reply handler adds `data-reply-user`, `data-reply-floor`, and an accessible label, prevents detached-anchor navigation, and preserves the existing `@username #floor ` insertion behavior.

If a fetched page lacks its own reliable native group, `loadPages` clones the safely captured current-page `nativeReplyControlsTemplate` and updates the floor and reply data for that reply. No generated speech-bubble icon, plain-text replacement floor, or unrelated native action is introduced. The relationship label `回复 #12` is retained as relationship metadata; it is not the right-side action label. Source-page navigation is limited to the separate thanks fallback. The native reply-action enhancement remains delegated separately and still lets V2EX's own handler run first.

Thanks metadata remains separate from the shared reply template. The count reuses that reply's sanitized `.small.fade` and original heart `img` in its source slot, without an emoji replacement. The action and completed state reuse native `thank_area`, `a.thank`, and `thanked` classes in the original group slot; successful feedback is `感谢已发送`. Hidden recovery controls add no whitespace to the normal action. A reusable reply-control template contains only an inert thanks slot, never another reply's eligibility or state. Created controls are registered in `topic.thanksControls`; event delegation verifies that registry and rejects controls inside reply content, so copying a CSS class into content cannot create an action. Native IDs and handlers are not copied. Keyboard and touch adaptations are limited to visibility and activation, with duplicate dispatch prevented and no separate visual design. The request/token/state adapter below is unchanged by the style correction.

## Reply thanks adapter

### Capability and source-page boundary

Only an active-page reply with its own recognized live native action can be submitted. Its numeric reply ID, source page, and native action identity are checked again at activation. A missing count remains unknown; a positive count neither establishes eligibility nor means the current user has thanked the reply. Parsed `thanked` state is separate from the aggregate count.

Cross-page ancestors display only their own count and thanked state. If the ancestor's own fetched markup proves a thanks action exists, the UI provides `到原页感谢` to its actual source page with `#wt-v2ex-thank-<reply-id>`. Initialization handles that fragment by selecting the native view and locating/focusing the matching control, including topics over 10 pages. Background loading preserves this explicit view choice; a manual view switch can replace it. No cross-page thanks POST is issued in this version. The generic reply-template fallback must never transfer thanks eligibility, identity, state, or a token from another reply. Unmatched or anonymous markup stays read-only.

### Request and token handling

The `unsafeWindow` grant is limited to checking the native `thankReply` capability, reading/updating the current page's `once`, and invoking its native `refreshMoney` after success. The adapter does not read a token from fetched HTML, execute handler strings, inject scripts, request a V2EX API token, or persist credentials. Missing page-context access or an invalid live token causes a native-view fallback.

The enhanced thanks action asks for confirmation that thanking a reply consumes 10 copper coins. Cancellation sends no request. After confirmation, one same-origin `fetch` POST addresses the verified real reply ID using the live token. This small adapter is used instead of calling `thankReply` or proxy-clicking its link because the native helper exposes no request result, making reliable cancellation, failure, and timeout handling unavailable to that approach.

Enhanced thanks writes are serialized and never automatically retried. A response updates the page's `once` only while the topic/page lifecycle is current and the live value still matches the token that was sent. This comparison avoids overwriting a token updated by a separate native action; it does not make native and enhanced requests mutually exclusive. Uncertain writes, missing/invalid replacement tokens, and old-lifecycle responses add their sent token to a document-lifetime blocked set without changing the new page's `once`. Enhanced sends remain unavailable for that token until a fresh valid live token is available or the document reloads.

### Outcomes and reconciliation

- A recognized `success === true` response confirms completion, updates the reply model and its native thanks area, and refreshes the native balance. A targeted source-page GET refreshes the aggregate count. A count is never incremented merely because a click or request was dispatched.
- A recognized business failure returns the action to idle and displays the response message. A valid replacement token is applied using the same lifecycle and compare-before-write checks. A retry requires another explicit user action and confirmation.
- Network errors, timeouts, and unrecognized responses produce an unknown outcome. The action remains blocked from resubmission, and `核对状态` performs only a source-page GET. A matching already-thanked state confirms success. A page that still offers thanks does not prove that the original write cannot complete later, so it does not unlock another POST; the unknown state and native fallback remain available.

State belongs to the reply model rather than its rendered node, so pagination redraws cannot reset an in-flight or completed action. A document-lifetime result map is keyed by origin, topic ID, and reply ID. It retains pending, confirmed, and uncertain writes across soft navigation so returning to the same reply cannot offer another write solely because its model was rebuilt. Confirmed thanks is monotonic: a later failure or unknown result cannot downgrade it. A response received after navigation may settle that exact reply's cached result, but cannot overwrite the new page's token or unrelated native DOM. Synchronization reads the corresponding native thanks state when returning to the enhanced view; acknowledgements in either view remain consistent. Updates affect the specific reply instead of rebuilding the relationship graph or fetching every page. Temporary observers, requests, and timers follow the topic lifecycle and are cleaned up on disposal.

### Verification boundaries

`validate-reply-thanks.mjs` covers adapter and state behavior with simulated page access and requests. `validate-browser-regressions.html` exercises the rendered controls, confirmation, synchronization, cross-page fallback, and existing pagination behavior with mocked network responses. Neither fixture spends real coins. Authenticated V2EX behavior, live server errors, and page-context access in Tampermonkey/Violentmonkey on Chromium/Firefox remain separate target-environment checks; fixture success is not reported as live-site verification.

## Two view modes

`楼中楼` exposes the inferred hierarchy. `renderThreadedView` uses an iterative stack: it starts with the visible roots, appends each cloned reply, creates a visible child container for replies with visible children, and pushes those children in reverse order to preserve source order. Exact and inferred children appear only under their parent; unresolved replies remain roots. A fresh render-once ID set prevents duplicate output. Loading another page can improve the hierarchy or add a minimal ancestor context, but it cannot expand the visible set to the entire topic.

`原始顺序` hides the custom threaded container and restores the native reply cells, including any confirmed thanks state. It does not rebuild or refetch the threaded model merely because the view changed. Repeated switching therefore preserves the two containers without duplicate replies/listeners and clears stale `aria-hidden` from the native list.

The former per-branch and global branch-state machinery has been removed. The panel click handler handles only view selection and optional full-page loading, and the threaded renderer creates only visible child containers. Thanks controls use their separate delegated action path.

## Pagination and fallback

Other pages are fetched from `location.origin` with same-origin credentials. At most three page GET requests run concurrently; each has a timeout and one retry for network/abort or 5xx failures. This read retry policy is not used for thanks writes. Up to 10 pages load automatically. Each reply prefers its own sanitized reply-control template; when absent, it receives a clone of the current-page reply template with its author, floor, data attributes, and accessible label updated. This fallback does not copy thanks metadata. Larger topics remain partial until the panel's explicit full-load button is activated. Results are merged by reply ID into `topic.allReplies`, relationships are recalculated globally, and `deriveVisibleThread(topic)` projects only the active native page plus required ancestors before the custom tree is rendered. Any partial failure reports in the panel and switches to the original reply list so the user never receives an invisibly empty topic. An async page load applies results only while its topic identity, URL key, `currentPage`, and monotonic navigation revision still match the live runtime topic; a stale load is discarded rather than changing view or page state after navigation. Navigation synchronization is coalesced, but every distinct topic/page transition advances the revision synchronously, so a page 1 → page 2 → page 1 sequence cannot make the original page-1 snapshot current again.

## Client-side image enhancement

Display enhancement is a separate browser-only stage: V2EX server content and submission behavior are unchanged, and users without WebTweaks retain the original URL/content.

`scanImageContent` accepts only known `.topic_content` and `.reply_content` containers. It is called during initial image-module setup, after every `renderThreadedView` rebuild and during soft-navigation synchronization. Switching modes only toggles the already processed native/threaded DOM, avoiding another full-document traversal. It does not install a broad DOM observer or scan arbitrary body changes.

`imagePreviewUrl` parses a candidate with `URL`, accepts only `http:` or `https:`, and checks the parsed pathname against the case-insensitive extensions `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, and `.avif`. Query strings and fragments therefore do not affect extension matching. SVG, HTML, data, blob, file, JavaScript, and unknown-extension URLs fail locally. The module sends no HEAD request, content-type probe, or metadata request.

That extension allowlist controls creation of new inline preview nodes. It does not hide an `<img>` that V2EX content already rendered: the lightbox may reuse that existing element's HTTP(S) source, while a surrounding full-size link is accepted only when it passes the same image-extension allowlist.

Each eligible anchor keeps its original text and href and receives `data-wt-v2ex-image-enhanced="true"`. A generated `img.wt-v2ex-inline-image` is inserted after the anchor with lazy loading, asynchronous decoding, and `referrerpolicy="no-referrer"`. Bare HTTP(S) URL text is handled by a scoped TreeWalker that excludes anchors, code, preformatted text, form controls, scripts, styles, and the lightbox. `data-wt-v2ex-image-text-enhanced` prevents repeated text scans. Threaded clones are new sanitized nodes after each rebuild, so they receive fresh markers without affecting native replies. If a generated image emits an error, the delegated capture handler removes it and leaves the source URL/link.

The preview menu toggle removes generated images and their markers when disabled, allowing a clean rescan when re-enabled. The settings schema is version 3 and contains `preferredView`, `scrollTopEnabled`, `imagePreviewEnabled`, and `imageLightboxEnabled`, with the image settings defaulting to true. Unknown legacy fields are dropped when the normalized settings are saved.

## Image lightbox lifecycle

One document-level click handler and one keydown handler cover images inside `.topic_content` and `.reply_content`. Images outside those containers—including avatars, reply arrows, navigation, and userscript controls—are ignored. Ctrl, Cmd, Shift, and Alt activation returns before `preventDefault()`, preserving link/browser behavior. Enter and Space activate prepared content images without per-image click listeners.

The lazily created `.wt-v2ex-image-lightbox` is a modal dialog containing a semantic close button, the preview image, and a safe `target="_blank"` original-image link. It accepts an already rendered content image's validated HTTP(S) source; when that image is wrapped by a link to a supported image extension, the linked full-size URL takes precedence over the thumbnail source. The image is centered within `92vw` by `90vh` and uses `referrerpolicy="no-referrer"`. Opening records the invoking image, scroll coordinates, and existing document/body overflow values before locking background scroll. The close button, Escape, or an overlay-background click closes it, restores the exact overflow and scroll position, and returns focus to the connected opener. A threaded rebuild closes the dialog before replacing its DOM and transfers focus to the matching replacement image. Tab cycles between the close button and original-image link.

Lightbox target preparation adds only missing keyboard/accessibility attributes and records which attributes WebTweaks added, so disabling the feature can remove them without overwriting native attributes. A single capture-phase error handler closes a failed lightbox load and removes failed generated previews. No iframe, remote script, arbitrary HTML, CSP bypass, telemetry, or browsing-history transmission is introduced; image bytes are requested directly from the URL's original host by the browser.

## Initialization invariants

Initialization is guarded by `document.documentElement.dataset.wtV2exInitialized`. There is one dock, one conversation panel/toggle on topic pages, one threaded container, one delegated native-action listener, one image-delegation set, and one scroll listener. Repeated initialization cannot create another dock, custom reply view, image listener set, or lightbox. On soft navigation, an open lightbox restores scrolling before the old panel/threaded container is cleaned up, then known image content is scanned for the new page.

Authenticated editor and native reply-action behavior could not be browser-tested in the unauthenticated execution environment. The public HTML confirmed the reply cell and native `.fr .no` floor structure; the authenticated arrow selector set remains defensive and must be rechecked after a V2EX markup change. The script retains defensive selectors, does not claim a native arrow when no reliable template exists, and leaves unmatched native behavior untouched.
