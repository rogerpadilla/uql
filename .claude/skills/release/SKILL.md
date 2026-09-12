---
name: release
description: Cut and publish a uql release - review the diff, changelog entry, version bump, tag push, GitHub Release, npm publish. Use when asked to release, cut a version, publish a package, or ship a patch/minor/major.
---

# Releasing uql

"Release" means all of this, not just the bump.

## 1. Review the whole diff

Staged and unstaged alike (and related files). Make sure to understand everything first, then correct what is wrong, simplify what is duplicated or overcomplicated, and delete comments the change made stale.

## 2. Settle the changelog entry

Compress `[Unreleased]` - the CHANGELOG.md header says how - then rename its heading to the version the bump will produce, dated today. Reorder so related bullets sit together.

`release.github` looks the entry up by the version it bumped to, so a heading naming a different version stops the release. What nothing checks is severity: decide the heading and the bump level together.

## 3. Verify the tests and clean compilation

`bun run check` is the gate. Beyond green: does every fix have a test that would have failed before it, at the cheapest level that pins it - exact SQL in a dialect spec, cross-backend behaviour in the shared suite?

## 4. Update the docs site

`~/projects/uql-site`. A fix that makes the code match what the docs already claimed needs no change; a new or changed behaviour does. Its `build` type-checks every example against the **published** package, so a doc naming something unreleased has to wait for step 6.

## 5. Bump, tag, push, release

Versioning and publishing are two steps on purpose: `lerna publish`'s npm step 404s unreliably against this registry. **Never run `lerna publish`.** A failed publish leaves the tag and CHANGELOG already right - rerun the publish alone, never re-bump.

```sh
bun run release.patch    # or .minor / .major
```

The `lerna version` prompt is deliberate, and hangs a non-interactive shell. There, take the bump and the rest separately - `--yes` has to reach `lerna version`, and a script's arguments only ever reach its last command:

```sh
bun run release patch --yes
bun run release.finish
```

The codemod is deliberately left out of the GitHub Release, so its bumps never notify people who never installed it.

## 6. Publish whichever package moved

Packages version independently, so a release usually moves only one; `lerna version` reports which.

```sh
bun run publish.orm
bun run publish.codemod
```

Each package's `prepack` builds first, so `dist` cannot lag the version being published. Re-publishing an existing version exits non-zero, so the exit code can be trusted. `bun run` loads the gitignored `.env`; anything invoking `npm` outside `bun` must export `NPM_ACCESS_TOKEN`.
