/**
 * Publishes a GitHub Release for the current `uql-orm` version, with that version's CHANGELOG entry as
 * its notes. `lerna version` only tags, and a tag notifies nobody: watchers subscribe to Releases,
 * trackers read the Releases API, and the sidebar reads "No releases published" until one exists.
 * The codemod is left out deliberately, so its bumps never notify people who never installed it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const succeeds = async (cmd: ReturnType<typeof $>): Promise<boolean> => (await cmd.quiet().nothrow()).exitCode === 0;

const { version } = JSON.parse(read('packages/uql-orm/package.json')) as { version: string };
const tag = `uql-orm@${version}`;

/** Hand-written before the bump, so a missing entry would otherwise publish empty release notes. */
function notes(): string {
  const entry = read('CHANGELOG.md')
    .split(/^## \[/m)
    .find((section) => section.startsWith(`${version}]`));

  if (!entry) {
    throw new TypeError(`CHANGELOG.md has no entry for ${version}`);
  }

  return entry.slice(entry.indexOf('\n') + 1).trim();
}

// Left to itself, `gh release create` tags HEAD when the tag is missing, releasing whichever commit
// happens to be checked out rather than the one that was versioned.
if (!(await succeeds($`git rev-parse --verify ${`refs/tags/${tag}`}`))) {
  throw new TypeError(`${tag} is not tagged yet: run the version bump before releasing`);
}

if (await succeeds($`gh release view ${tag}`)) {
  console.log(`${tag} is already released`);
} else {
  await $`gh release create ${tag} --title ${`uql-orm ${version}`} --latest --notes ${notes()}`;
  console.log(`released ${tag}`);
}
