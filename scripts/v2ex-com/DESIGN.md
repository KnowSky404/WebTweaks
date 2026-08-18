# V2EX Conversation Enhancer Design

## Scope and verified DOM

This is one readable, independently installable userscript. It does not import a framework, package, sanitizer, or hosted runtime. Public V2EX HTML was inspected on 2026-08-18 using:

- `https://www.v2ex.com/t/1234938` (public topic replies);
- `https://www.v2ex.com/t/1234095?p=2` (page 2 of a multi-page topic);
- `https://www.v2ex.com/new` (redirected to sign-in in the unauthenticated environment).

The current public reply structure is `#Main > div[id^="r_"].cell` with `id="r_<reply-id>"`. Within it, `.no` contains the floor, `strong > a.dark[href^="/member/"]` identifies the author, `img.avatar` identifies the avatar, `.ago[title]` contains the source timestamp, and `.reply_content` contains rendered content. Pagination is in `.cell.ps_container`, with `.page_current`, `.page_normal`, `.page_input`, and links containing `?p=`. The public pages did not expose authenticated reply actions or editors; those selectors remain defensive.

## Shared floating dock

`wt-v2ex-control-dock` is the one idempotent fixed component used by navigation and conversation controls. On topic pages it contains, in order, the hidden `wt-v2ex-conversation-panel`, the `会话` toggle, and the `wt-v2ex-scroll-top` button. On other V2EX pages it contains only the scroll button when that setting is enabled. The dock uses the lower-right safe area; the panel is positioned above the toggle and has a narrow-screen width cap.

The conversation panel is a non-modal, keyboard-operable region. It starts closed after a full page load, exposes `aria-expanded` and `aria-controls` on the toggle, uses pressed state for view selection, and exposes loading/failure text in an `aria-live="polite"` status region. A second toggle click, Escape, or an outside pointer click closes it. Focus is not trapped because the panel does not block the page. Scroll-to-top remains a direct one-click action and is hidden independently at the top of the page or when disabled.

## Reply model and parsing

Every parsed reply retains:

```text
id, floor, page, author, avatarUrl, timeText, contentHtml, contentText,
nativeTemplate, mentionedUsers, explicitReplyFloor, parentId,
relationshipConfidence, unresolvedReason, children
```

`nativeTemplate` is a sanitized clone of the current-page or fetched native reply element. The live current-page element is never moved or mutated during cloning. Fetched HTML is parsed into a detached `Document`, cloned, and sanitized before import into the live page.

Native IDs are removed from the template root and descendants. The original identity is stored only as `data-wt-v2ex-reply-id` on the rendered clone and is used to construct the source-page `定位原楼` URL. When V2EX supplies no reply ID, the parser uses a deterministic page/floor/index fallback instead of a random value, so malformed replies do not collapse into one identity.

## Relationship inference and child uniqueness

The existing relationship model remains intentionally conservative. Exact `@username #floor` relationships require an earlier floor and matching author. A single username without a floor is inferred from the nearest earlier reply by that author. Multiple mentions, invalid floors, and missing earlier authors remain unresolved roots. Roots are derived only from `!reply.parentId`, so both exact and inferred children are excluded from the top-level sequence while unresolved replies remain roots.

`renderThreadedView` uses a fresh `Set` of reply IDs for every render. Before a model is emitted, its ID is checked; a duplicate is skipped with the existing log prefix and a warning. Normal data produces no warning. Switching views only changes visibility, so it does not rebuild the tree, duplicate clones, refetch pages, or add listeners. Pagination rebuilds the one custom container after merging and inference.

The observed duplicate-child failure was caused by the native reply elements remaining visible: the old `.wt-v2ex-native-hidden { display:none; }` rule had insufficient specificity against the V2EX/user stylesheet, so the custom child and its original native reply were both visible. The new targeted selectors are:

```css
#Main .cell[id^="r_"].wt-v2ex-native-hidden,
#Wrapper .cell[id^="r_"].wt-v2ex-native-hidden
```

They use `display: none !important` only for this third-party native-reply visibility override. The native nodes remain in the DOM for fallback. Threaded mode sets `aria-hidden="true"` on every native reply and exposes the custom view; original mode removes that attribute and restores every native reply.

## Native-template threaded rendering

The threaded renderer clones the sanitized native `.cell` and adds no separate reply surface. It preserves the native table, avatar, author, metadata, `.reply_content`, and content descendants so V2EX theme CSS and user CSS continue to control typography and surfaces. The renderer does not set a reply font family, font size, weight, text alignment, white-space, or line height, and does not impose a separate reply background, border, radius, or card padding.

Sanitization removes scripts, styles, forms, form controls, embedded documents, duplicate IDs, inline event attributes, unsafe URLs, native action controls, and controls that could trigger thank, ignore, moderation, or submission behavior. Safe links are normalized against their source document; external links receive `rel="noopener noreferrer"`, and images are lazy-loaded. The clone is detached from the original live reply and has no duplicate `id="r_*"`.

Hierarchy styling is limited to the prefixed threaded parent, branch indentation, a guide line, a six-level visual cap, relationship markers, branch controls, focus styles, and narrow-screen wrapping. The logical tree remains deeper than six levels. The custom panel may use a neutral compact surface; reply rows inherit native light/dark surfaces and typography.

## Header actions

`createReplyCard` locates the native reply content cell and wraps the native header nodes before `.sep5` in the scoped `wt-v2ex-reply-header`. This verified header area includes the native floor `.fr .no`, member link, badges, and `.ago` timestamp. The script appends a small `wt-v2ex-reply-actions` group to that same row with a real `button` for `回复` and an `a` for `定位原楼`. `margin-left: auto` places the actions at the far right while allowing them to wrap below the metadata on narrow screens. The reply action continues to insert `@username #floor ` through the existing editor path.

Native action controls are removed from the sanitized clone before this group is added, preventing duplicate or unsafe behavior. The native reply-action enhancement remains delegated separately and still lets V2EX's own handler run first.

## Pagination and fallback

Other pages are fetched from `location.origin` with same-origin credentials. At most three requests run concurrently; each has a timeout and one retry for network/abort or 5xx failures. Up to 10 pages load automatically. Larger topics remain partial until the panel's explicit full-load button is activated. Results are merged by reply ID, relationships are recalculated, and the custom tree is rendered once. Any partial failure reports in the panel and switches to the untouched original reply list so the user never receives an invisibly empty topic.

## Editor and Imgur flow

The editor, paste, drag-and-drop, file validation, Imgur request, reply-prefix, menu settings, and native-action enhancement paths are intentionally outside the threaded rendering change. Their existing least-privilege metadata remains unchanged: no new grants, hosts, dependencies, telemetry, or shared credentials are introduced.

## Initialization invariants

Initialization is guarded by `document.documentElement.dataset.wtV2exInitialized`. There is one dock, one conversation panel/toggle on topic pages, one threaded container, one editor observer, one delegated native-action listener, and one scroll listener. Repeated initialization cannot create another dock or custom reply view. The Imgur controls remain next to their recognized editors and are never moved into the shared dock.

Authenticated editor and native reply-action behavior could not be browser-tested in the unauthenticated execution environment. The script retains defensive selectors and leaves unmatched native behavior untouched.
