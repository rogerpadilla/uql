---
name: release
description: Cut and publish a uql release - review the change, changelog entry, commit, version bump and tag, GitHub Release, npm publish, docs site. Use when asked to release, cut a version, publish a package, or ship a patch/minor/major.
---

# Releasing uql

"Release" means every step below, not just the bump.

## 1. Review the change

Everything `git status` lists, untracked files included, since `lerna version` leaves them out silently. Understand all of it first, then fix what is wrong, unify, simplify, and delete comments the change made stale. Every fix needs a test that failed before it, at the cheapest level that pins it: exact SQL in a dialect spec, cross-backend behaviour in the shared suite. A public API change updates `skills/uql-orm/SKILL.md` too.

`bun run check` passes, with the databases up (`docker compose up -d --wait`).

## 2. Settle the changelog entry and the level

Compress `[Unreleased]` as the CHANGELOG.md header says, related bullets together, only what a user really needs (what worth it). Rename the heading to the version the bump will produce, dated today. Summarize, simplify and unify.

Nothing checks the level, so take it from the entry. Pre-1.0 a caret range takes every patch of its minor (`^0.81.0` is `<0.82.0`), so a patch reaches users unasked:

- **minor**: a `**Breaking:**` bullet, new API, or a step for the upgrade guide.
- **patch**: fixes only.

## 3. Commit

If the review edited anything, stop and let the user read that unstaged diff first: everything after the commit is public. One commit, CHANGELOG included, since `lerna version` refuses a dirty tree: `feat:` or `fix:`, `!` when breaking, the subject saying what users get.

## 4. Bump, tag, push, GitHub Release

```sh
bun run release patch --yes    # or minor / major: check, bump, commit, tag, push
bun run release.finish         # push again, then the GitHub Release from the changelog entry
```

Run them apart: `release.patch` chains the two, but `lerna version`'s prompt hangs a non-interactive shell, and a script's arguments reach only its last command. The codemod gets no GitHub Release, so its bumps notify nobody who never installed it.

From here, never bump again: fix what failed and rerun that step alone (`release.finish`, `release.github`, `gh run rerun <id>`).

## 5. Publish to npm

The tag push publishes: [publish.yml](../../../.github/workflows/publish.yml) runs once per tag, through npm's trusted publishing. Never publish from a machine, `lerna publish` included; the packages refuse tokens.

```sh
gh run list --workflow publish.yml --limit 2    # one run per package tagged
gh run watch <id> --exit-status
```

## 6. Update the docs site

`~/projects/uql-site` pins `uql-orm` exactly and compiles every example against it, the skill's included, so it follows a green publish; drafts can start earlier.

1. `bun add --exact uql-orm@<version>`.
2. Document new or changed behaviour; a fix that makes the code match the docs needs nothing. A release that asks anything of users gets a section in `upgrade-guide.mdx`, a new codemod rewrite a bullet in `codemod.md`.
3. `bun run check`, then commit and push.
