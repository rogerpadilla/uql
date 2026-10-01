import { execSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

/**
 * An example's end-to-end check: apply its schema, require no drift left, boot its server, then write
 * a todo and read it back over HTTP. Run from the example's directory, through its `smoke` script.
 */
const { values } = parseArgs({
  options: {
    schema: { type: 'string' },
    drift: { type: 'string' },
    serve: { type: 'string' },
    url: { type: 'string' },
  },
});
const { schema, drift, serve, url } = values;
if (!schema || !drift || !serve || !url) {
  throw new Error('usage: smoke.ts --schema <cmd> --drift <cmd> --serve <cmd> --url <todos url>');
}

execSync(schema, { stdio: 'inherit' });

const pending = execSync(drift, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
if (pending) {
  throw new Error(`The schema still differs from the entities:\n${pending}`);
}

const server = spawn(serve, { shell: true, stdio: 'inherit', detached: true });

async function until(ready: () => Promise<Response>, attempts = 120): Promise<Response> {
  try {
    return await ready();
  } catch (error) {
    if (!attempts) throw error;
    await new Promise((done) => setTimeout(done, 500));
    return until(ready, attempts - 1);
  }
}

try {
  await until(() => fetch(url));
  const title = `smoke ${Date.now()}`;
  const created = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!created.ok) {
    throw new Error(`POST ${url} answered ${created.status}: ${await created.text()}`);
  }
  const todos: { title: string }[] = await (await fetch(url)).json();
  if (!todos.some((todo) => todo.title === title)) {
    throw new Error(`GET ${url} did not return the todo just written: ${JSON.stringify(todos)}`);
  }
  console.log(`smoke: OK (${todos.length} todos)`);
} finally {
  if (server.pid) process.kill(-server.pid);
}
