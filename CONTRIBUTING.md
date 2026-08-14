# Contributing

Keep contributions small, readable, and focused on a real website or feature need.

When adding a script:

1. Inspect the repository and read [`docs/SCRIPT_GUIDE.md`](docs/SCRIPT_GUIDE.md).
2. Add it under `scripts/<site-slug>/` with a lowercase kebab-case `.user.js` name.
3. Use narrow metadata matches and least-privilege permissions.
4. Set or update the script's independent SemVer-style version.
5. Manually test installation, matching, behavior, repeated initialization, and relevant navigation.
6. Add a real entry to the root README index and update useful site documentation.

When modifying an existing script, preserve unrelated behavior, explain assumptions, bump its version when behavior changes, and repeat the relevant manual checks. Avoid unrelated refactoring, new build systems, dependencies, tracking, and secrets.
