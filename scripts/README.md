# Scripts

Place each userscript in a directory named for its target website:

```text
scripts/<site-slug>/<feature-slug>.user.js
```

Use lowercase kebab-case for both directory and file names. Each `.user.js` file should be standalone and directly installable in a userscript manager. Keep source readable and do not require a build step or runtime dependencies.

An optional per-site `README.md` is appropriate when a site has useful setup, permission, or troubleshooting notes. Put site-specific implementation knowledge near that site's scripts.

Every script must begin with a valid userscript metadata block and use narrow `@match` patterns and the least-privileged `@grant` and `@connect` declarations it needs. See [`../docs/SCRIPT_GUIDE.md`](../docs/SCRIPT_GUIDE.md) for the complete guide.
