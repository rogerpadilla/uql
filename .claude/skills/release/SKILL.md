---
name: release
description: Cut and publish a uql release - changelog entry, version bump, tag push, GitHub Release, npm publish. Use when asked to release, cut a version, publish a package, or ship a patch/minor/major.
---

# Releasing uql

Versioning and publishing are two steps on purpose: `lerna publish`'s npm step 404s unreliably against this registry. **Never run `lerna publish`.** A failed publish then leaves the tag and CHANGELOG already right - rerun the publish alone, never re-bump.

Packages version independently, so a release usually moves only one.

## 1. Changelog entry, before the bump

`release.github` reads the notes from `CHANGELOG.md` and throws when the entry is missing.

Compress the `[Unreleased]` section first - the CHANGELOG.md header says how - then rename its heading to the version the bump will produce, dated today. Nothing checks that the two agree - a patch heading over breaking changes publishes wrong notes, so decide the heading and the bump level together.

## 2. Bump, tag, push, release

```sh
bun run release.patch    # or .minor / .major
```

The `lerna version` prompt is deliberate, and hangs a non-interactive shell. There, run the pieces:

```sh
bun run release patch --yes
git push --follow-tags
bun run release.github
```

The codemod is deliberately left out of the GitHub Release, so its bumps never notify people who never installed it.

## 3. Publish whichever package moved

`lerna version` reports which changed; publish only those.

```sh
bun run publish.orm
bun run publish.codemod
```

Each package's `prepack` builds first, so `dist` cannot lag the version being published. Re-publishing an existing version exits non-zero, so the exit code can be trusted. `bun run` loads the gitignored `.env`; anything invoking `npm` outside `bun` must export `NPM_ACCESS_TOKEN`.
