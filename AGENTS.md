# AGENTS.md

WebTweaks is a lightweight collection of standalone userscripts. Tampermonkey is the primary manager; scripts should remain compatible with Violentmonkey, Chromium-based browsers, and Firefox wherever reasonably possible.

## Required development workflow

This workflow applies to every repository change, including features, bug fixes, refactoring, tests, documentation, configuration, and review follow-ups.

1. Inspect the repository, working-tree status, and existing worktrees before editing. Fetch `origin/main`, then create a dedicated task branch and a separate Git worktree from that ref. Perform all task edits, validation, and commits in that worktree. Continue review fixes in the same task worktree. Do not develop in the primary checkout, commit directly on `main`, or push directly to `main`. Preserve unrelated work and other tasks' worktrees.
2. Complete the scoped change, required version and documentation updates, and relevant validation. Inspect the final diff, commit only task files, push the task branch to `origin`, and open a ready-for-review PR against `main` using the repository template. Describe the resulting behavior, validation, assumptions, and limitations.
3. Wait for the Codex bot to complete its review of the current PR head. Read the PR conversation, submitted reviews, and inline review threads. Request a Codex review if automatic review does not start. Silence, a pending review, a skipped or failed review, and a quota or service error do not constitute review approval. If review is unavailable, keep the PR open and report the blocker.
4. Address actionable findings in the same worktree, rerun relevant checks, commit, and push. Explain any disputed findings in the PR instead of silently dismissing them. After every new push or branch rebase, obtain a fresh Codex review of the new head. Do not merge with unresolved actionable findings or outstanding change requests.
5. Merge only after Codex has explicitly completed review without outstanding issues for the current head, all required status checks have passed, and GitHub confirms the PR is mergeable against the current base. Use **Rebase and merge** exclusively, pinning the operation to the reviewed head SHA. Do not substitute squash or a merge commit, bypass protections, or enable auto-merge before these conditions are satisfied. If conflicts require updating the task branch, validate and obtain review again; use `--force-with-lease` only on that task branch when a rebase requires it, after inspecting its remote state.
6. Confirm GitHub reports the PR as merged before cleanup. Delete the PR's remote task branch, remove its clean task worktree, and delete its local task branch after checking that neither branch contains later or unpushed work. Prune stale remote-tracking refs and fast-forward the primary checkout's `main` only when it is clean. Never force-remove a dirty worktree or discard unrelated changes. A rebase merge rewrites commit SHAs, so verify the merged PR and branch contents before deleting a local branch that Git still considers unmerged.
7. Carry the authorized task through push, PR creation, review fixes, rebase merge, and cleanup without asking for routine confirmation between stages. If an external blocker prevents completion, preserve the PR, branch, and worktree and report exactly what remains. The final report must include the PR link, validation and review results, merge status, and cleanup status.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the practical sequence and command examples. Repository settings or missing bot access are blockers to report, not reasons to bypass this workflow.

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

Documented exception: genuine cross-site tools may use `scripts/cross-site/` and broad HTTP(S) matches. They must default to inactive or explicitly scoped behavior, document privacy/security boundaries, and keep inactive-page overhead minimal. This does not change the narrow-match requirement for website-specific scripts; see `docs/SCRIPT_GUIDE.md`.

Site-specific implementation knowledge belongs near that site's scripts rather than accumulating as unrelated global abstractions.

Do not generalize code shared by two scripts merely because it looks similar. Introduce shared abstractions only when there is a demonstrated maintenance benefit.

## Toolchain and scope

This repository intentionally has no JavaScript build toolchain during its bootstrap phase. Do not add package managers, bundlers, TypeScript, linters, or browser automation infrastructure unless a real future requirement justifies one. Do not create demonstration userscripts, speculative site directories, releases, or tags.

Before finishing a bootstrap or documentation change, inspect all created files, verify Markdown and YAML syntax, check links and paths, confirm no placeholder is presented as a supported script, and review the final repository tree.
