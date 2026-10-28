# WebTweaks

WebTweaks is a collection of standalone userscripts for improving, optimizing, and customizing everyday websites.

Scripts are written for [Tampermonkey](https://www.tampermonkey.net/) and should remain compatible with Violentmonkey and current Chromium-based browsers and Firefox wherever reasonably possible.

## Installation

Install a compatible userscript manager, then open a script's raw `.user.js` file and confirm the installation. Each script is independently installable; cloning the repository or running a build is not required.

## Script index

| Website | Script | Description | Install |
| --- | --- | --- | --- |
| [chatgpt.com](https://chatgpt.com/) | ChatGPT Account Usage Dashboard | Private, read-only floating dashboard for the current plan, Codex limits, cycle analysis, model usage percentage, and usage analytics. | [Install raw script](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/chatgpt-com/account-usage-dashboard.user.js) |
| [V2EX](https://v2ex.com/) | V2EX Conversation Enhancer | Page-isolated threaded replies with cross-page ancestor context, native thanks/count/reply presentation, client-side image previews and lightbox viewing, and scroll-to-top. | [Install raw script](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js) |
| [Cross-site, opt-in](scripts/cross-site/README.md) | Browser Environment Spoofer | Default-disabled, per-origin JavaScript language, locale, DST-aware timezone, and simulated geolocation with local settings and diagnostics. | [Install raw script](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/cross-site/browser-environment.user.js) |

## Repository structure

```text
scripts/<site-slug>/<feature-slug>.user.js
```

Genuine cross-site tools live under `scripts/cross-site/` and must default to inactive or explicitly scoped behavior. Their broad matching, privacy boundaries, and limitations are documented beside each script.

See [`scripts/README.md`](scripts/README.md) for the short placement guide and [`docs/SCRIPT_GUIDE.md`](docs/SCRIPT_GUIDE.md) for the canonical authoring rules.

## Development

Before changing the repository, read [`AGENTS.md`](AGENTS.md), inspect the relevant site and script files, and keep the change focused. New scripts should be human-readable, independently installable, least-privilege, and manually tested on their target website. Update this index when adding a script.

Every change, including documentation and bug fixes, must be developed in a dedicated Git worktree and task branch, pushed, and submitted as a PR against `main`. Wait for Codex review of the current head, address its findings, and pass required checks before using **Rebase and merge**. After confirming the merge, delete the remote and local task branches and remove the task worktree.

The full workflow and contribution requirements are described in [`CONTRIBUTING.md`](CONTRIBUTING.md). Do not add secrets, tracking, or unrelated toolchain infrastructure.

## License

WebTweaks is distributed under the [GNU Affero General Public License version 3.0](LICENSE).
