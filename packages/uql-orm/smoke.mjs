/**
 * Post-pack gate: the published tarball resolves and runs on every runtime we claim to support.
 *
 * The entry list comes from the installed manifest rather than this file, so adding an export to
 * `package.json` covers it here automatically, on every runtime, with no edit to CI. Adding a
 * runtime is one more line in the workflow.
 *
 * Deliberately `.mjs` and dependency-free: it runs byte-identical on Node, Deno, Bun and any
 * fetch-only runtime, with no transpile step to make the thing under test differ per runtime.
 *
 * Run from a directory where the tarball is installed, once per runtime:
 *   node smoke.mjs / deno run smoke.mjs / bun smoke.mjs
 */

import pkg from 'uql-orm/package.json' with { type: 'json' };

const runtime = globalThis.Deno
  ? `deno ${Deno.version.deno}`
  : globalThis.Bun
    ? `bun ${Bun.version}`
    : `node ${process.versions.node}`;

/**
 * No peers are installed on purpose: that is what a consumer who uses one dialect actually has.
 *
 * The same list as `external` in verify-dist.ts, copied rather than imported because this file runs
 * from a temp directory where only the tarball exists, with no path back into the repo. Change one
 * and change the other.
 */
const peers = [...Object.keys(pkg.peerDependencies ?? {}), 'bun', 'bun:sqlite'];

/**
 * The entries that wrap a third-party driver or framework, mapped to the peer each one is allowed to
 * be missing. Every *other* entry must load on every runtime with nothing else installed, which is
 * the "an edge bundle pulls no native binaries" claim: `d1`, `turso`, `libsql`, `sqlite` and
 * `browser` reach their driver lazily, so they resolve on a bare install.
 *
 * A map, not a set of entry names, because "this entry failed on *some* peer" is too weak to be a
 * gate. `neon` shipped statically importing `pg` once; `pg` is a declared peer, so a set-based skip
 * filed a broken edge entry as expected and the check was green. An entry may only be excused for
 * the driver it is named for. Extra loads are fine: `bunSql` loads on Bun and nowhere else.
 */
const PEER_ENTRIES = {
  mysql: ['mysql2'],
  postgres: ['pg'],
  cockroachdb: ['pg'],
  maria: ['mariadb'],
  mongo: ['mongodb'],
  express: ['express'],
  // Two value imports, so which one the runtime names first is not ours to pick.
  nestjs: ['@nestjs/common', '@nestjs/core'],
  neon: ['@neondatabase/serverless'],
  bunSql: ['bun'],
};

/**
 * Matched as a quoted specifier, not as a substring: every runtime quotes the module it could not
 * resolve, and a bare `includes('bun')` also matches the `dist/bunSql/` in the same message, which
 * would let a genuinely broken entry pass as an absent peer. A peer can be imported at a subpath
 * (`mysql2/promise`) and runtimes disagree on which half they name: Node and Deno report the
 * package, Bun reports the subpath.
 */
const missingPeer = (message) =>
  peers.find((name) => [`'${name}'`, `'${name}/`, `"${name}"`, `"${name}/`].some((quoted) => message.includes(quoted)));

const entries = Object.keys(pkg.exports)
  .filter((entry) => entry !== './package.json')
  .map((entry) => (entry === '.' ? '' : entry.slice(2)));

const loaded = [];
const skipped = [];
const broken = [];

for (const entry of entries) {
  const specifier = entry ? `${pkg.name}/${entry}` : pkg.name;
  try {
    await import(specifier);
    loaded.push(entry);
  } catch (err) {
    const message = String(err).split('\n')[0];
    const peer = missingPeer(message);
    if (peer && PEER_ENTRIES[entry]?.includes(peer)) {
      skipped.push(`${entry} (${peer})`);
    } else {
      broken.push(`${specifier}: ${message}`);
    }
  }
}

const root = await import(pkg.name);
for (const name of ['Entity', 'Field', 'Id', 'getMeta', 'defineEntity']) {
  if (!(name in root)) broken.push(`missing root export: ${name}`);
}

// Imports resolving proves nothing about the code running, so build one query end to end.
class User {}
root.defineEntity(User, {
  fields: { id: { type: Number, isId: true }, email: { type: String } },
});
// The dialects left the root entry in 0.38.0, and every entry but this family needs a driver peer
// the smoke install deliberately does not have - so SQLite is the one that proves the code runs.
const { SqliteDialect } = await import(`${pkg.name}/sqlite`);
const dialect = new SqliteDialect();
const ctx = dialect.createContext();
dialect.find(ctx, User, {
  $select: { id: true, email: true },
  $where: { email: { $endsWith: '@uql-orm.dev' } },
  $limit: 10,
});

const expected = 'SELECT `id`, `email` FROM `User` WHERE `email` LIKE ? LIMIT 10';
if (ctx.sql !== expected) broken.push(`generated SQL: ${ctx.sql}`);
if (ctx.values[0] !== '%@uql-orm.dev') broken.push(`bound values: ${JSON.stringify(ctx.values)}`);

if (broken.length) {
  console.error(`smoke: ${pkg.name}@${pkg.version} is broken on ${runtime}:`);
  for (const problem of broken) console.error(`  ${problem}`);
  process.exit(1);
}

// The skipped list is printed, not counted: which entries a runtime cannot load is the finding.
console.log(
  `smoke ok on ${runtime}: ${loaded.length}/${entries.length} entries loaded, query built` +
    (skipped.length ? `\n  peer absent, not loaded: ${skipped.join(', ')}` : ''),
);
