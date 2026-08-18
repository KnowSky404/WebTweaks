# V2EX Conversation Enhancer Design

## Scope and verified DOM

This is one readable, independently installable userscript. It does not import a framework, package, sanitizer, or hosted runtime. Public V2EX HTML was inspected on 2026-08-18 using:

- `https://www.v2ex.com/t/1234938` (two pages, public replies);
- `https://www.v2ex.com/t/1234095?p=2` (page 2 of 6, 100 replies, floors 101–200);
- `https://www.v2ex.com/new` (redirected to sign-in in the unauthenticated environment).

The current public reply structure is `#Main > div[id^="r_"].cell` with `id="r_<reply-id>"`. Within it, `.no` contains the floor, `strong > a.dark[href^="/member/"]` identifies the author, `img.avatar` identifies the avatar, `.ago[title]` contains the source timestamp, and `.reply_content` contains rendered content. Pagination is in `.cell.ps_container`, with `.page_current`, `.page_normal`, `.page_input`, and links containing `?p=`. Thank counts were observed as `.small.fade img[alt="❤️"]` with a numeric parent text node.

The anonymous pages did not contain a reply textarea, a new-topic editor, or a visible native reply action. The editor candidates are therefore intentionally defensive: `#reply_content`, `#topic_content`, and `textarea[name="content"]`, restricted to textareas in forms. Authenticated browser verification is still required before claiming coverage of those controls.

## Modules

The source is organized in this order: configuration and selectors; manager-backed settings; DOM and URL utilities; reply parsing; relationship inference; threaded rendering; native/custom reply actions; editor discovery; Imgur upload; scroll-to-top; initialization and local error boundaries.

All injected classes begin with `wt-v2ex-`. Initialization uses a topic key, a `WeakSet` for editors, one editor observer, one scroll button, and one delegated native-action listener. Re-running the initialization path therefore does not duplicate custom controls or listeners.

## Reply model and parsing

Every parsed reply retains:

```text
id, floor, page, author, avatarUrl, timeText, contentHtml, contentText,
thankCount, mentionedUsers, explicitReplyFloor, parentId,
relationshipConfidence, unresolvedReason, children
```

The source page is retained and the original link is built with `URL` from `location.origin`, for example `/t/<topic>?p=2#r_<id>`. Invalid floors remain marked as `null`; missing optional fields do not abort the page. Duplicate IDs are detected during merge and are not silently overwritten. Duplicate floors are recorded by the inference pass and explicit references to them become unresolved.

The leading-prefix parser reads the rendered text and verifies leading member links against `/member/` anchors. Only structural mentions at the beginning are considered. A mention later in normal prose does not become a parent. A single `@user #123` is the only form eligible for an exact relationship; multiple leading mentions remain unresolved unless no ambiguity exists, and this implementation conservatively treats them as unresolved.

## Relationship inference

Replies are sorted by numeric floor. The pass builds `replyByFloor` and updates `earlierRepliesByNormalizedAuthor` once per reply, keeping the algorithm approximately O(n). Exact floor references require an earlier floor and matching author. Invalid explicit references stay at root level with a reason. A single username without a floor attaches to the nearest earlier reply by that normalized author and is labeled inferred. Replies without a structural prefix stay roots. Parent links are only accepted when the parent floor is lower than the child floor, so malformed content cannot create self-links or cycles.

The logical tree is rendered with an iterative stack rather than recursive calls. CSS depth classes stop increasing visual indentation after level 6 while preserving all child nodes. Roots and siblings retain chronological floor order.

## Pagination and fallback

The current page is parsed directly from the live DOM. Other pages are fetched from `location.origin` with `credentials: 'same-origin'`; no V2EX API token or hard-coded V2EX host is used. Page discovery uses actual pagination links and the page input's maximum rather than assuming a reply count per page.

At most three page requests run concurrently. Each request has an `AbortController` timeout and retries once for a network/abort failure or HTTP 5xx. Results are merged after a partial-failure-safe `Promise.all` worker queue. Up to 10 pages load automatically. Over 10 pages, the current page is rendered as incomplete and the user must activate the full-load button. A failed load never hides the original reply elements. The threaded view is a separate container; native replies are hidden only with the script-owned class while threaded mode is active.

## Rendering and sanitization

Cards are created with DOM APIs and inserted through a `DocumentFragment`. Each card includes avatar, user, floor, source page, timestamp, relationship status, reply action, and original-location link. Branch buttons are real buttons with `aria-expanded`; toolbar view controls expose pressed state. No native thank, ignore, moderation, or submission endpoint is cloned.

Fetched reply content is cloned and sanitized locally before `innerHTML` insertion. `script`, `style`, `iframe`, `form`, `object`, `embed`, `template`, and form controls are removed. Inline event attributes, IDs, unsafe URLs, and non-HTTP(S) image sources are removed. Relative and HTTP(S) links are normalized; external links receive `rel="noopener noreferrer"`; images use lazy loading. No remote sanitizer is required.

## Reply actions

The custom reply button uses `setRangeText` where available, preserving the selection and surrounding text, then dispatches a bubbling `input` event and focuses the editor. It avoids repeating an existing matching username/floor prefix. The native enhancement is capture-delegated only to known reply-action selectors; it does not replace V2EX handlers and waits one task so a native `@username` insertion can be augmented with `#floor`. If the authenticated DOM does not match a reliable action, nothing is changed.

## Editor and Imgur flow

Only recognized textareas in forms are enhanced. A `WeakSet` prevents duplicate controls. A narrowly coalesced `MutationObserver` rescans candidate selectors for dynamically inserted editors. Paste handling intercepts only image `clipboardData.items`; ordinary text paste is untouched. Drop handling accepts only image MIME types. The file picker uses `accept="image/*"` and permits multiple sequential uploads.

Each file is checked for an `image/*` MIME type and a maximum size of 10 MiB before `GM_xmlhttpRequest`. The request is `POST https://api.imgur.com/3/image` with `Authorization: Client-ID <manager-stored-client-id>` and `FormData`; the ID is never logged or rendered. Responses must have a successful HTTP status, valid JSON, a non-false `success` value where supplied, and an HTTPS `data.link`. Network/timeout/5xx failures retry once; authentication, quota, size, and other client failures do not.

The returned direct URL is inserted at the current selection. A reply receives the URL on its own line. A topic editor receives Markdown only when an active Markdown marker is detected or it is the current `#topic_content` without a plain-mode marker; uncertain editors use the direct URL. No form is submitted. A privacy notice explains the third-party anonymous-upload boundary on the first upload interaction.

## Settings and failure boundaries

One manager-backed object at `wt-v2ex-settings` contains `version`, `preferredView`, `imgurClientId`, `scrollTopEnabled`, and `uploaderEnabled`. Menu commands mutate only these values. Client ID clearing uses the manager delete API before saving the normalized object. No image bytes, V2EX cookies, tokens, telemetry, or upload history are stored.

Topic, editor, and scroll initialization are individually guarded. An exception in page parsing keeps native replies and does not prevent the editor or scroll modules from initializing. Upload errors are rendered beside the affected editor and never overwrite its value. The scroll button uses a passive listener and `requestAnimationFrame`; its action respects reduced motion and safe-area insets.

## Maintenance hotspots

The selectors most likely to require updates after a V2EX redesign are the reply block and content selectors, the `.ps_container` pagination selectors, the member author link, and authenticated editor/native-action candidates. The public HTML inspection did not prove the logged-in editor DOM, so changes to those candidates should be verified in an authenticated disposable browser session before expanding their scope.
