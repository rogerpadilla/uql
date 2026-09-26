/**
 * The package runs on every runtime we claim to support, with no driver installed: `verify-dist.ts`
 * runs it with Node, Bun and Deno in a consumer project holding `dist` alone.
 *
 * The entry list comes from the installed manifest, so a new export in `package.json` is covered here
 * with no edit. Deliberately `.mjs` and dependency-free, so it runs byte-identical on each runtime.
 */

import pkg from 'uql-orm/package.json' with { type: 'json' };
import checks from './peers.json' with { type: 'json' };

const runtime = globalThis.Deno
  ? `deno ${Deno.version.deno}`
  : globalThis.Bun
    ? `bun ${Bun.version}`
    : `node ${process.versions.node}`;

/**
 * No peers are installed on purpose: that is what a consumer who uses one dialect actually has. Which
 * peers exist, and which an entry may be missing as it loads, is `verify-dist.ts`'s `DRIVER_ENTRIES`,
 * written beside this file since only `dist` is here, with no path back into the repo.
 */
const { peers, driverEntries } = checks;

/**
 * Matched as a quoted specifier, not as a substring: every runtime quotes the module it could not
 * resolve, and a bare `includes('bun')` also matches the `dist/bunSql/` in the same message, which
 * would let a genuinely broken entry pass as an absent peer. A peer can be imported at a subpath
 * (`mysql2/promise`) and runtimes disagree on which half they name: Node and Deno report the
 * package, Bun reports the subpath.
 */
const missingPeer = (message) =>
  peers.find((name) => [`'${name}'`, `'${name}/`, `"${name}"`, `"${name}/`].some((quoted) => message.includes(quoted)));

const entries = Object.keys(pkg.exports).filter((entry) => entry !== './package.json');

const loaded = [];
const skipped = [];
const broken = [];

for (const entry of entries) {
  const specifier = `${pkg.name}${entry.slice(1)}`;
  try {
    await import(specifier);
    loaded.push(entry);
  } catch (err) {
    const message = String(err).split('\n')[0];
    const peer = missingPeer(message);
    if (peer && driverEntries[entry]?.loads?.includes(peer)) {
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

// Imports resolving proves nothing about the code running, so build one query end to end. The SQL
// itself is the dialect specs' to pin; this only proves one comes out.
class User {}
root.defineEntity(User, {
  fields: { id: { type: Number, isId: true }, email: { type: String } },
});
// Every other dialect's entry needs a driver peer the consumer project deliberately does not have.
const { SqliteDialect } = await import(`${pkg.name}/sqlite`);
const dialect = new SqliteDialect();
const ctx = dialect.createContext();
dialect.find(ctx, User, { $select: { id: true }, $where: { email: 'a@uql-orm.dev' } });

if (!ctx.sql.startsWith('SELECT ')) broken.push(`generated SQL: ${ctx.sql}`);
if (JSON.stringify(ctx.values) !== '["a@uql-orm.dev"]') broken.push(`bound values: ${JSON.stringify(ctx.values)}`);

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
