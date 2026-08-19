# V2EX Conversation Enhancer Design

## Scope and verified DOM

This is one readable, independently installable userscript. It does not import a framework, package, sanitizer, or hosted runtime. Public V2EX HTML was inspected on 2026-08-18 using:

- `https://www.v2ex.com/t/1234938` (public topic replies);
- `https://www.v2ex.com/t/1234095?p=2` (page 2 of a multi-page topic);
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

Pagination is in `.cell.ps_container`, with `.page_current`, `.page_normal`, `.page_input`, and links containing `?p=`. The public pages did not expose authenticated reply actions or editors; those selectors remain defensive. For authenticated reply controls, extraction is scoped to the reply header's `.fr` group. The implementation checks a V2EX-owned `img[alt="Reply"]` or reply-asset filename, then the existing action selectors, and finally clickable elements whose original `onclick` or `href` contains `replyOne(...)`. It never searches for reply images page-wide.

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
contentHtml, contentText, thankCount, mentionedUsers,
normalizedMentions, explicitReplyFloor,
hasMultipleStructuralMentions, hasStructuralMention,
parentId, relationshipConfidence, unresolvedReason, children,
nativeTemplate, nativeReplyControlsTemplate
```

`nativeTemplate` is a sanitized clone of the current-page or fetched native reply element. The live current-page element is never moved or mutated during cloning. Fetched HTML is parsed into a detached `Document`, cloned, and sanitized before import into the live page.

Native IDs are removed from the template root and descendants. The original identity is stored only as `data-wt-v2ex-reply-id` on the rendered clone and is used for render-once duplicate protection. No source-page navigation URL is retained in the reply model because threaded mode no longer provides an original-floor navigation action.

## Relationship inference and child uniqueness

The existing relationship model remains intentionally conservative. Exact `@username #floor` relationships require an earlier floor and matching author. A single username without a floor is inferred from the nearest earlier reply by that author. Multiple mentions, invalid floors, and missing earlier authors remain unresolved roots. Roots are derived only from `!reply.parentId`, so both exact and inferred children are excluded from the top-level sequence while unresolved replies remain roots.

`renderThreadedView` uses a fresh `Set` of reply IDs for every render. Before a model is emitted, its ID is checked; a duplicate is skipped with the existing log prefix and a warning. Normal data produces no warning. Switching views only changes visibility, so it does not rebuild the tree, duplicate clones, refetch pages, or add listeners. Pagination rebuilds the one custom container after merging and inference.

## Native reply visibility and original mode

The native reply cells remain in the DOM for fallback. When the custom view is selected, `applyTopicView` adds `wt-v2ex-native-hidden` and `aria-hidden="true"` to each native reply. When `原始顺序` is selected, it removes both the class and `aria-hidden`, and the native list is shown again.

The source uses these targeted selectors:

```css
#Main .cell[id^="r_"].wt-v2ex-native-hidden,
#Wrapper .cell[id^="r_"].wt-v2ex-native-hidden {
  display: none !important;
}
```

They use `display: none !important` only for this third-party native-reply visibility override. The native nodes remain in the DOM for fallback. Original mode therefore retains V2EX's native floor, reply action, chronological ordering, and event behavior; clone-only cleanup never changes those live cells.

## Native-template threaded rendering

The threaded renderer clones the sanitized native `.cell` and adds no separate reply surface. It preserves the native table, avatar, author, metadata, `.reply_content`, and content descendants so V2EX theme CSS and user CSS continue to control typography and surfaces. The renderer does not set a reply font family, font size, weight, text alignment, white-space, or line height, and does not impose a separate reply background, border, radius, or card padding.

`sanitizeReplyTemplate` removes scripts, styles, forms, form controls, embedded documents, duplicate IDs, inline event attributes, unsafe URLs, native action controls, and controls that could trigger thank, ignore, moderation, or submission behavior. Safe links are normalized against their source document; external links receive `rel="noopener noreferrer"`, and images are lazy-loaded. The clone is detached from the original live reply and has no duplicate `id="r_*"`.

The clone-only header cleanup runs after the native header nodes have been wrapped in `wt-v2ex-reply-header`. When a cloned `.fr` group contains the native floor or reply action, the entire group is removed after capture; this also guarantees that thank, ignore, report, moderation, delete, and other unrelated right-side actions cannot remain in the threaded header. A scoped fallback removes the header floor/action candidates when no `.fr` group exists. The original controls have already been captured as a separate `nativeReplyControlsTemplate`, so cleanup cannot discard the controls that will be rendered. These operations are applied only inside the cloned header; no generic page-wide `.no`, image, anchor, or `.fr` removal is used.

Hierarchy styling is limited to the prefixed threaded parent, child indentation, a guide line, a six-level visual cap, relationship markers, focus styles, and narrow-screen wrapping. The logical tree remains deeper than six levels. Child containers are always appended and remain visible; they have no per-branch visibility or expanded/collapsed state.

## Header actions

`createReplyCard` locates the native reply content cell and wraps the native header nodes before `.sep5` in the scoped `wt-v2ex-reply-header`. The verified header area includes the native floor, member link, badges, and `.ago` timestamp. Before cleanup, `parseReply` captures the reply's native `.fr` control group into `nativeReplyControlsTemplate`.

The rendered right-side group is `.fr.wt-v2ex-native-reply-controls` and contains, in exact order:

1. the sanitized clone of the native reply anchor/image (or a semantic button wrapper only when the source is not keyboard-interactive);
2. the sanitized native `.no` floor badge, updated to the reply's parsed floor.

The scoped `.wt-v2ex-native-reply-controls` rule sets `float: none`, `margin-left: auto`, and a high flex order, moving the preserved native group to the far right without changing the arrow image, its dimensions or safe inline presentation, or the `.no` colors, border, radius, font, or background. The header may wrap naturally at narrow widths; the group is not forced onto a second line at normal desktop widths. Inline handlers, duplicate IDs, unsafe URLs, and stateful data attributes are removed from the detached control. The delegated handler adds `data-reply-user`, `data-reply-floor`, and an accessible label, prevents detached-anchor navigation, and preserves the existing `@username #floor ` insertion behavior.

If a fetched page lacks its own reliable native group, `loadPages` clones the safely captured current-page `nativeReplyControlsTemplate` and updates the floor and reply data for that reply. No generated speech-bubble icon, plain-text replacement floor, or unrelated native action is introduced. The relationship label `回复 #12` is retained as relationship metadata; it is not the right-side action label. The threaded header has no original-floor navigation action. The native reply-action enhancement remains delegated separately and still lets V2EX's own handler run first.

## Two view modes

`楼中楼` exposes the inferred hierarchy. `renderThreadedView` uses an iterative stack: it starts with roots, appends each cloned reply, creates a visible child container for replies with children, and pushes those children in reverse order to preserve source order. Exact and inferred children appear only under their parent; unresolved replies remain roots. A fresh render-once ID set prevents duplicate output.

`原始顺序` hides the custom threaded container and restores the untouched native reply cells. It does not rebuild or refetch the threaded model merely because the view changed. Repeated switching therefore preserves the two containers without duplicate replies/listeners and clears stale `aria-hidden` from the native list.

The former per-branch and global branch-state machinery has been removed. The panel click handler handles only view selection and optional full-page loading, and the threaded renderer only creates visible child containers.

## Pagination and fallback

Other pages are fetched from `location.origin` with same-origin credentials. At most three requests run concurrently; each has a timeout and one retry for network/abort or 5xx failures. Up to 10 pages load automatically. Each reply prefers its own sanitized native control template; when absent, it receives a clone of the current-page native template with its author, floor, data attributes, and accessible label updated. Larger topics remain partial until the panel's explicit full-load button is activated. Results are merged by reply ID, relationships are recalculated, and the custom tree is rendered once. Any partial failure reports in the panel and switches to the untouched original reply list so the user never receives an invisibly empty topic.

## Editor and Imgur flow

The editor, paste, drag-and-drop, file validation, Imgur request, reply-prefix, menu settings, and native-action enhancement paths are intentionally outside the threaded rendering change. Their existing least-privilege metadata remains unchanged: no new grants, hosts, dependencies, telemetry, or shared credentials are introduced.

## Initialization invariants

Initialization is guarded by `document.documentElement.dataset.wtV2exInitialized`. There is one dock, one conversation panel/toggle on topic pages, one threaded container, one editor observer, one delegated native-action listener, and one scroll listener. Repeated initialization cannot create another dock or custom reply view. The Imgur controls remain next to their recognized editors and are never moved into the shared dock. On soft navigation, the old panel and threaded container are cleaned up before the new topic starts with a closed panel.

Authenticated editor and native reply-action behavior could not be browser-tested in the unauthenticated execution environment. The public HTML confirmed the reply cell and native `.fr .no` floor structure; the authenticated arrow selector set remains defensive and must be rechecked after a V2EX markup change. The script retains defensive selectors, does not claim a native arrow when no reliable template exists, and leaves unmatched native behavior untouched.
