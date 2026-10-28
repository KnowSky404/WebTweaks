# Contributing

Keep contributions small, readable, and focused on a real website or feature need.

## Required worktree and PR workflow

All changes, including documentation, configuration, refactoring, and fixes requested during review, must follow this workflow. Read [`AGENTS.md`](AGENTS.md) and the relevant files before editing. Keep the primary checkout available for a clean `main`; perform development in a separate worktree on a task branch. Never commit or push directly to `main`.

### Start a task

Inspect existing changes and worktrees, fetch the current base, and create a new branch and worktree. For example, run the following from the primary checkout, replacing the example topic with the actual task:

```sh
git status --short --branch
git worktree list
git fetch origin main
git worktree add -b docs/workflow-update ../WebTweaks-worktrees/workflow-update origin/main
cd ../WebTweaks-worktrees/workflow-update
```

Use a focused branch name such as `feat/<topic>`, `fix/<topic>`, or `docs/<topic>`, with a lowercase kebab-case topic. Preserve existing work and use a different branch and directory if the names are already in use.

### Implement, validate, and open the PR

Make the scoped changes and run relevant checks in the task worktree. Follow the script requirements below when userscripts change. Inspect the diff, stage only task files, commit, and push the task branch with `git push -u origin <task-branch>`.

Open a ready-for-review PR targeting `main`, using [the PR template](.github/pull_request_template.md). Explain the problem, resulting behavior, validation performed, and any assumptions or limitations. Documentation-only changes must also use a worktree, branch, and PR; they do not require a userscript version bump.

### Wait for review and address findings

Wait for the Codex bot to finish reviewing the current PR head. Check the PR conversation, submitted reviews, inline threads, and required status checks. If automatic review does not start, explicitly request a Codex review. An empty comment list, pending review, skipped review, quota error, or service failure is not a successful review. If the bot cannot review, keep the PR open and report the blocker.

Fix actionable findings in the same task worktree, rerun relevant validation, commit, and push. Explain disagreements in the PR and resolve actionable discussions before merging. Every new push, including a branch rebase or conflict resolution, requires a fresh Codex review of the new head. Existing change requests and required checks must also be satisfied.

### Rebase merge and clean up

Once Codex review is complete without outstanding issues on the current head, all required checks pass, and GitHub confirms mergeability against the current base, use **Rebase and merge**. Pin the merge to the reviewed head SHA so a later push cannot be merged without review. Do not use squash, merge commits, protection bypasses, or early auto-merge. For example, with GitHub CLI:

```sh
gh pr merge <pr-number> --rebase --match-head-commit <reviewed-head-sha>
```

If conflicts require rebasing the task branch, inspect its remote state first, rebase onto the fetched base, validate again, and obtain a fresh review after pushing. When rewriting that branch requires a force push, use `--force-with-lease` only on the task branch.

Confirm the PR is actually merged on GitHub before cleanup. Check that the remote and local task branches have no later commits or unpushed work, then delete the remote task branch. From the primary checkout, remove the clean task worktree and delete the local task branch. Rebase merging changes commit SHAs, so `git branch -d` can refuse even after a successful merge; use `git branch -D` only after verifying the merged PR and confirming the local branch has no additional work. Never force-remove a dirty worktree or delete another task's branch.

Finally, fetch with pruning and fast-forward the primary checkout's `main` when it is clean. Leave unrelated local work intact. Include the PR link, validation and review results, merge status, and branch/worktree cleanup status in the final report. Continue through these stages without routine confirmation; if permissions, review availability, or failing checks block progress, preserve the PR and task worktree and report what remains instead of bypassing the gate.

## Userscript changes

When adding a script:

1. Inspect the repository and read [`docs/SCRIPT_GUIDE.md`](docs/SCRIPT_GUIDE.md).
2. Add it under `scripts/<site-slug>/` with a lowercase kebab-case `.user.js` name. Genuine cross-site tools may use the documented `scripts/cross-site/` exception.
3. Use narrow metadata matches and least-privilege permissions.
4. Set or update the script's independent SemVer-style version.
5. Manually test installation, matching, behavior, repeated initialization, and relevant navigation.
6. Add a real entry to the root README index and update useful site documentation.

When modifying an existing script, preserve unrelated behavior, explain assumptions, bump its version when behavior changes, and repeat the relevant manual checks. Avoid unrelated refactoring, new build systems, dependencies, tracking, and secrets.
