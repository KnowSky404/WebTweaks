# Scripts

Place each userscript in a directory named for its target website:

```text
scripts/<site-slug>/<feature-slug>.user.js
```

Use lowercase kebab-case for both directory and file names. Each `.user.js` file should be standalone and directly installable in a userscript manager. Keep source readable and do not require a build step or runtime dependencies.

Genuine cross-site tools use `cross-site/` rather than a website slug. Broad HTTP(S) matching is permitted only with default-disabled or explicitly scoped behavior, documented privacy/security boundaries, and minimal inactive-page overhead. See the [cross-site scripts](cross-site/README.md) for their activation rules; website-specific scripts still require narrow matches.

An optional per-site `README.md` is appropriate when a site has useful setup, permission, or troubleshooting notes. Put site-specific implementation knowledge near that site's scripts.

Every script must begin with a valid userscript metadata block and use narrow `@match` patterns and the least-privileged `@grant` and `@connect` declarations it needs. See [`../docs/SCRIPT_GUIDE.md`](../docs/SCRIPT_GUIDE.md) for the complete guide.
