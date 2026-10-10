---
name: release
description: Cut and publish a uql release - review, changelog, commit, version bump and tag, GitHub Release, npm publish, docs site.
disable-model-invocation: true
---

# Releasing uql

"Release" means every step below, not just the bump.

1. **Review**: run the `review` skill. Here a fix is pinned by exact SQL in a dialect spec, or cross-backend behaviour in the shared suite; a public API change updates `skills/uql-orm/SKILL.md`. `bun run check` needs the databases up (`docker compose up -d --wait`).
2. **Changelog**: compress the last entry to what users need, related bullets unified. Head it with the version the bump will produce, dated today.
3. **Level**: **patch** by default, new API and changes to anything undocumented included. **Minor** only when code written from the docs stops working, which is also what earns an upgrade-guide step; a `**Breaking:**` bullet only as the changelog header says. Pre-1.0 a caret takes every patch of its minor (`^0.81.0` is `<0.82.0`), so a patch reaches users unasked: never ship a documented break in one.
4. **Commit** the change.
5. **Bump, tag, push, GitHub Release**:
   ```sh
   bun run release patch --yes   # or minor / major: check, bump, commit, tag, push
   bun run release.finish        # push again, then the GitHub Release from the changelog entry
   ```
6. **npm**: the tag push publishes through [publish.yml](../../../.github/workflows/publish.yml) and npm's trusted publishing, one run per package tagged. Watch it with `gh run list --workflow publish.yml --limit 2` and `gh run watch <id> --exit-status`.
7. **Docs site**, after a green publish (`~/projects/uql-site` pins `uql-orm` exactly and compiles every example against it): `bun add --exact uql-orm@<version>`, document new or changed behaviour, give a release that asks anything of users a section in `upgrade-guide.mdx` and a new codemod rewrite a bullet in `codemod.md`, then `bun run check`, commit and push.

## Gotchas

- Run the two release commands apart: `release.patch` chains them, but `lerna version`'s prompt hangs a non-interactive shell, and a script's arguments reach only its last command.
- After the tag, never bump again: fix what failed and rerun that step alone (`release.finish`, `release.github`, `gh run rerun <id>`).
- Never publish from a machine, `lerna publish` included; the packages refuse tokens.
- The codemod gets no GitHub Release, so its bumps notify nobody who never installed it.
