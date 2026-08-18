# WebTweaks

WebTweaks is a collection of standalone userscripts for improving, optimizing, and customizing everyday websites.

Scripts are written for [Tampermonkey](https://www.tampermonkey.net/) and should remain compatible with Violentmonkey and current Chromium-based browsers and Firefox wherever reasonably possible.

## Installation

Install a compatible userscript manager, then open a script's raw `.user.js` file and confirm the installation. Each script is independently installable; cloning the repository or running a build is not required.

## Script index

| Website | Script | Description | Install |
| --- | --- | --- | --- |
| [chatgpt.com](https://chatgpt.com/) | ChatGPT Account Usage Dashboard | Private, read-only floating dashboard for the current plan, Codex limits, credits, and available usage analytics. | [Install raw script](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/chatgpt-com/account-usage-dashboard.user.js) |
| [V2EX](https://v2ex.com/) | V2EX Conversation Enhancer | Cross-page threaded replies, Imgur image uploads, and a scroll-to-top control. | [Install raw script](https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js) |

## Repository structure

```text
scripts/<site-slug>/<feature-slug>.user.js
```

See [`scripts/README.md`](scripts/README.md) for the short placement guide and [`docs/SCRIPT_GUIDE.md`](docs/SCRIPT_GUIDE.md) for the canonical authoring rules.

## Development

Before changing the repository, read [`AGENTS.md`](AGENTS.md), inspect the relevant site and script files, and keep the change focused. New scripts should be human-readable, independently installable, least-privilege, and manually tested on their target website. Update this index when adding a script.

Contributions are described in [`CONTRIBUTING.md`](CONTRIBUTING.md). Do not add secrets, tracking, or unrelated toolchain infrastructure.

## License

WebTweaks is distributed under the [GNU Affero General Public License version 3.0](LICENSE).
