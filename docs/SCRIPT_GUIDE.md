# Userscript authoring guide

This is the canonical guide for adding or modifying a WebTweaks userscript.

## Placement and names

Use one lowercase kebab-case directory per target website and one standalone file per feature:

```text
scripts/<site>/<script-name>.user.js
```

Do not use broad category directories such as `misc` or `temp`. Add a per-site `README.md` only when it provides useful site-specific context.

## Metadata

The metadata block must be the first content in the file. Use the narrowest practical page matches and only the permissions the script actually uses.

```javascript
// ==UserScript==
// @name         <script-name>
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.0.0
// @description  <description>
// @author       KnowSky404
// @match        https://<site>/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/KnowSky404/WebTweaks
// @supportURL   https://github.com/KnowSky404/WebTweaks/issues
// @updateURL    https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/<site>/<script-name>.user.js
// @downloadURL  https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/<site>/<script-name>.user.js
// ==/UserScript==
```

Use `@grant none` when no userscript APIs are needed. Otherwise declare each API explicitly. Declare `@connect` only for required external hosts; never use `@connect *` without a concrete, documented reason. Use `@run-at` only when the chosen timing is meaningful for the implementation.

Update and download URLs should point to the canonical raw GitHub path once the script exists. Do not add metadata for paths that do not exist.

## JavaScript structure

Keep the distributed source readable and independently installable. Prefer an isolated scope, `const` by default, descriptive names, focused functions, and comments that explain non-obvious reasons:

```javascript
(() => {
  'use strict';

  function initialize() {
    // Site-specific enhancement.
  }

  initialize();
})();
```

Do not introduce a build system, runtime dependency, or shared abstraction merely because two scripts look similar. Generalize only when there is a demonstrated maintenance benefit.

## Safe DOM changes

Check that queried elements exist before using them. Make initialization idempotent, mark injected elements where useful, avoid duplicate UI, and minimize interference with the site's handlers and styles. Use narrow selectors and handle site redesigns by failing only the affected enhancement where possible.

Use `MutationObserver` only when dynamic content requires it. Scope the observation, coalesce expensive work, keep processing idempotent, and disconnect when it is no longer needed. Avoid permanent short-interval polling.

For single-page applications, account for relevant soft navigation. Choose a targeted route or container strategy instead of adding generic SPA machinery to every script.

## CSS

Scope injected selectors to the target UI and prefix custom classes with `wt-`, for example `wt-toolbar` or `wt-hidden`. Avoid `!important` unless necessary. If a script adds visible UI, support the target site's light and dark themes where practical.

## Security and privacy

Never commit passwords, cookies, session tokens, API keys, credential-bearing URLs, browser profile data, authentication headers, or personal account identifiers. Do not add analytics, telemetry, tracking, or remote executable JavaScript. Treat `@require` as executable third-party code and avoid it by default.

If external requests are essential, document why, limit hosts, handle failures gracefully, and never send website or user data or authentication information without explicit project requirements.

## Versioning

Each script has its own SemVer-style version: `MAJOR.MINOR.PATCH`. Use a major version for incompatible behavior or a redesign, a minor version for functionality, and a patch version for fixes. Bump the script version when behavior changes; documentation-only changes do not require a script version bump.

## Manual testing checklist

Before release, verify:

- the userscript manager parses and installs the metadata;
- intended pages match and unrelated pages do not;
- the expected behavior works on the target site;
- repeated initialization does not duplicate effects;
- normal website behavior remains intact;
- relevant SPA navigation works;
- the console has no unexpected exceptions;
- light and dark themes work when the script adds UI.

Automated tests for pure logic are welcome when worthwhile, but do not build a browser automation framework for this repository bootstrap.

## Updating the index

When adding a script, add one real row to the root README's Script index with the website, script name, concise description, and a raw GitHub installation link. Do not add placeholder or speculative entries. Keep the change scoped to the target site and update relevant site documentation.
