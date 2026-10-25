/**
 * Renames each member the fixtures declare through the TypeScript language server, the way an editor does,
 * and fails on every mention a rename leaves behind: decorated entities in `rename.test-d.ts`, schema ones in
 * `renameSchema.test-d.ts`. `tsc` cannot see this: a key whose type lost its link to the entity's member still
 * type-checks, it just stops following renames and find-references.
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
const FIXTURES = ['rename.test-d.ts', 'renameSchema.test-d.ts'];

/** The options of a schema whose entries each declare a member. */
const MEMBER_OPTIONS: ReadonlySet<string> = new Set(['fields', 'computed', 'relations']);

/** A symbol as the language server outlines a document, with the LSP kinds this reads. */
type DocumentSymbol = {
  readonly name: string;
  readonly kind: number;
  readonly selectionRange: { readonly start: Position };
  readonly children?: readonly DocumentSymbol[];
};
/** The LSP `SymbolKind` values this reads. */
const SymbolKind = { Class: 5, Method: 6, Property: 7 } as const;
const MEMBER = new Set<number>([SymbolKind.Method, SymbolKind.Property]);

/**
 * The members each entity of a fixture declares, where a rename of them starts: a class's properties and methods,
 * a schema's fields, computed columns and relations. A class's decorators outline above its name, so its members
 * are what follows it. `id` is left out, since every entity repeats it.
 */
function declaredMembers(symbols: readonly DocumentSymbol[]): DocumentSymbol[] {
  return symbols
    .flatMap((symbol) =>
      symbol.kind === SymbolKind.Class
        ? (symbol.children ?? []).filter(
            (child) => MEMBER.has(child.kind) && child.selectionRange.start.line > symbol.selectionRange.start.line,
          )
        : (symbol.children ?? [])
            .filter((option) => MEMBER_OPTIONS.has(option.name))
            .flatMap((option) => option.children ?? []),
    )
    .filter((member) => member.name !== 'id');
}

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

await request('initialize', {
  processId: process.pid,
  rootUri: pathToFileURL(root).href,
  capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
});
send({ method: 'initialized', params: {} });

const failures: string[] = [];
const renamedMembers: string[] = [];
for (const file of FIXTURES) {
  const fixture = resolve(root, 'packages/orm/src/type', file);
  const uri = pathToFileURL(fixture).href;
  const source = readFileSync(fixture, 'utf8');
  const lines = source.split('\n');
  const positionOf = (offset: number): Position => {
    const before = source.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before.at(-1)!.length };
  };
  const mentionsOf = (name: string): Position[] =>
    [...source.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].map((match) => positionOf(match.index));

  send({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: 'typescript', version: 1, text: source } },
  });
  const outline = await request('textDocument/documentSymbol', { textDocument: { uri } });
  for (const { name, selectionRange } of declaredMembers((outline.result as DocumentSymbol[] | null) ?? [])) {
    const response = await request('textDocument/rename', {
      textDocument: { uri },
      position: selectionRange.start,
      newName: `${name}Renamed`,
    });
    const renamed = new Set(
      ((response.result as RenameResult | null)?.changes?.[uri] ?? []).map((edit) => key(edit.range.start)),
    );
    const missed = mentionsOf(name).filter((mention) => !renamed.has(key(mention)));
    failures.push(...missed.map(({ line }) => `  ${file}, ${name}, line ${line + 1}: ${lines[line].trim()}`));
    renamedMembers.push(name);
  }
}
server.kill();

if (failures.length) {
  console.error(`A rename left ${failures.length} mention(s) behind:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`type-rename: ${renamedMembers.length} members, every mention renamed (${renamedMembers.join(', ')}).`);
