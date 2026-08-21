# AGENTS.md

WebTweaks is a lightweight collection of standalone userscripts. Tampermonkey is the primary manager; scripts should remain compatible with Violentmonkey, Chromium-based browsers, and Firefox wherever reasonably possible.

## Repository invariants

- Inspect the repository before changing anything. Read the root README and the relevant site or script files first.
- Preserve existing behavior unless the task explicitly changes it, and keep changes scoped to the requested site or feature.
- Keep every userscript independently installable as readable `.user.js` source. Do not add a build system or runtime dependency without a concrete justification.
- Use lowercase kebab-case site directories and feature filenames.
- Put a valid metadata block first in every script; use narrow `@match` rules, least-privilege `@grant` values, and only required `@connect` hosts.
- Keep initialization idempotent, make DOM operations defensive, and consider SPA navigation when the target site needs it.
- Prefix injected CSS classes with `wt-`, scope selectors, and avoid unnecessary `!important`.
- Update a script's SemVer-style metadata version when its behavior changes. Update relevant documentation and the root README index.
- Userscript versioning requirement:
  - Any behavior change, feature addition, bug fix, or user-visible modification in a `.user.js` file MUST update the userscript `@version` metadata.
  - A changed userscript without a version bump is incomplete because Tampermonkey and Violentmonkey use userscript metadata versions to determine available updates.
  - When modifying a userscript, check the current `@version` before finishing, increment it according to semantic intent, and keep internal version constants synchronized when present.
- Test syntax and important behaviors before finishing, including installation, page matching, repeated initialization, normal site behavior, relevant navigation, and unexpected console errors.
- Never commit secrets, credentials, cookies, tokens, account identifiers, tracking, or unrelated local changes.
- Report assumptions, validation performed, and remaining limitations.

Site-specific implementation knowledge belongs near that site's scripts rather than accumulating as unrelated global abstractions.

Do not generalize code shared by two scripts merely because it looks similar. Introduce shared abstractions only when there is a demonstrated maintenance benefit.

## Toolchain and scope

This repository intentionally has no JavaScript build toolchain during its bootstrap phase. Do not add package managers, bundlers, TypeScript, linters, or browser automation infrastructure unless a real future requirement justifies one. Do not create demonstration userscripts, speculative site directories, releases, or tags.

Before finishing a bootstrap or documentation change, inspect all created files, verify Markdown and YAML syntax, check links and paths, confirm no placeholder is presented as a supported script, and review the final repository tree.
