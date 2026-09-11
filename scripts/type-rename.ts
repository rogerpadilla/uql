/**
 * Renames each field and relation `rename.test-d.ts` declares through the TypeScript language server,
 * the way an editor does, and fails on every mention of it the rename leaves behind. `tsc` cannot see
 * this: a key whose type lost its link to the entity property still type-checks, it just stops
 * following renames and find-references.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Position = { readonly line: number; readonly character: number };
type TextEdit = { readonly range: { readonly start: Position } };
type RenameResult = { readonly changes?: Readonly<Record<string, readonly TextEdit[]>> };
type Message = { readonly id?: number; readonly method?: string; readonly result?: unknown; readonly error?: unknown };

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const fixture = resolve(root, 'packages/uql-orm/src/type/rename.test-d.ts');
const uri = pathToFileURL(fixture).href;
const source = readFileSync(fixture, 'utf8');
const lines = source.split('\n');

/** The fields, relations and methods the fixture's entities declare, each renamed in turn; `id` repeats. */
const targets = [...source.matchAll(/^\s+(?:@\w+\(.*\) )?(?!id\b)(\w+)(?:\?:|\(\): void \{\})/gm)].map(
  (match) => match[1],
);

const positionOf = (offset: number): Position => {
  const before = source.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before.at(-1)!.length };
};

const mentionsOf = (name: string): Position[] =>
  [...source.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].map((match) => positionOf(match.index));

const key = ({ line, character }: Position) => `${line}:${character}`;

const server = spawn(resolve(root, 'node_modules/.bin/tsc'), ['--lsp', '--stdio'], { cwd: root });
const pending = new Map<number, (message: Message) => void>();
let buffer = Buffer.alloc(0);
let lastId = 0;

const send = (message: object) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};

server.stdout.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, headerEnd).toString())?.[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const message: Message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.subarray(headerEnd + 4 + length);
    if (message.id === undefined) continue;
    const resolveRequest = pending.get(message.id);
    if (resolveRequest) {
      pending.delete(message.id);
      resolveRequest(message);
    } else if (message.method) {
      // A request from the server (configuration, capabilities): nothing to offer.
      send({ id: message.id, result: null });
    }
  }
});

const request = (method: string, params: object) =>
  new Promise<Message>((resolveRequest) => {
    const id = ++lastId;
    pending.set(id, resolveRequest);
    send({ id, method, params });
  });

await request('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} });
send({ method: 'initialized', params: {} });
send({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri, languageId: 'typescript', version: 1, text: source } },
});

const failures: string[] = [];
for (const name of targets) {
  const [declaration] = mentionsOf(name).filter(({ line }) =>
    new RegExp(`\\b${name}(\\?:|\\(\\): void)`).test(lines[line]),
  );
  const response = await request('textDocument/rename', {
    textDocument: { uri },
    position: declaration,
    newName: `${name}Renamed`,
  });
  const renamed = new Set(
    ((response.result as RenameResult | null)?.changes?.[uri] ?? []).map((edit) => key(edit.range.start)),
  );
  const missed = mentionsOf(name).filter((mention) => !renamed.has(key(mention)));
  failures.push(...missed.map(({ line }) => `  ${name}, line ${line + 1}: ${lines[line].trim()}`));
}
server.kill();

if (failures.length) {
  console.error(`A rename left ${failures.length} mention(s) behind in ${fixture}:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`type-rename: ${targets.length} members, every mention renamed (${targets.join(', ')}).`);
