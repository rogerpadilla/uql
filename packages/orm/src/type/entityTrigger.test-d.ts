import { Entity, Field, Id } from '../entity/index.js';
import { raw } from '../util/raw.js';
import type { RefMap, TriggerOptions } from './index.js';

@Entity()
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  @Field({ type: String }) searchVector?: string | null;
  @Field({ type: String }) status?: string | null;
}

const tsvectorOf = (newRow: RefMap<Post>) => raw`${newRow.searchVector} := to_tsvector('english', ${newRow.body});`;

// An insert body reads the incoming row.
() => ({ on: 'beforeInsert', run: (newRow) => tsvectorOf(newRow) }) satisfies TriggerOptions<Post>;

// An update body reads either row, or both.
() =>
  ({
    on: 'beforeUpdate',
    of: (post) => [post.body],
    run: (newRow, oldRow) => raw`${newRow.status} := coalesce(${oldRow.status}, 'new');`,
  }) satisfies TriggerOptions<Post>;

// A delete body reads the outgoing row, in the same place it holds on an update.
() => ({ on: 'afterDelete', run: (_newRow, oldRow) => raw`PERFORM log(${oldRow.id});` }) satisfies TriggerOptions<Post>;

// Each row keeps its place on every event, so one body reading the outgoing row serves an update and a delete.
const logOld = (_newRow: unknown, oldRow: RefMap<Post>) => raw`PERFORM log(${oldRow.id});`;
() =>
  [
    { on: 'afterUpdate', run: logOld },
    { on: 'afterDelete', run: logOld },
  ] satisfies TriggerOptions<Post>[];

// A `where` callback reads the same rows the body does.
() =>
  ({
    on: 'afterUpdate',
    where: (newRow, oldRow) => raw`${oldRow.status} <> ${newRow.status}`,
    run: () => raw`x`,
  }) satisfies TriggerOptions<Post>;

// A predicate names the row it reads: a transition reads both.
() =>
  ({
    on: 'afterUpdate',
    where: { $old: { status: 'draft' }, $new: { status: 'published' } },
    run: () => raw`x`,
  }) satisfies TriggerOptions<Post>;

// @ts-expect-error an insert has no outgoing row for a predicate to read
() => ({ on: 'afterInsert', where: { $old: { status: 'x' } }, run: () => raw`x` }) satisfies TriggerOptions<Post>;

// @ts-expect-error a delete has no incoming row for a predicate to read
() => ({ on: 'afterDelete', where: { $new: { status: 'x' } }, run: () => raw`x` }) satisfies TriggerOptions<Post>;

// @ts-expect-error a `where` callback reads only the rows its event has, as the body does
() => ({ on: 'afterInsert', where: (_n, old) => raw`${old.id}`, run: () => raw`x` }) satisfies TriggerOptions<Post>;

// @ts-expect-error a predicate says which row it reads, rather than one being picked for it
() => ({ on: 'afterInsert', where: { status: 'draft' }, run: () => raw`x` }) satisfies TriggerOptions<Post>;

// A body may be written per engine where a project targets several.
() =>
  ({
    on: 'afterInsert',
    run: { postgres: (newRow) => raw`PERFORM f(${newRow.id});`, mysql: (newRow) => raw`CALL f(${newRow.id});` },
  }) satisfies TriggerOptions<Post>;

// @ts-expect-error a field the entity does not have cannot be watched
() => ({ on: 'beforeUpdate', of: (post) => [post.nope], run: () => raw`x` }) satisfies TriggerOptions<Post>;

// @ts-expect-error `of` names columns that only an update has two sides of
() => ({ on: 'beforeInsert', of: (post) => [post.body], run: () => raw`x` }) satisfies TriggerOptions<Post>;

// @ts-expect-error an insert has no previous row to read
() => ({ on: 'beforeInsert', run: (_newRow, oldRow) => raw`${oldRow.body}` }) satisfies TriggerOptions<Post>;

// @ts-expect-error a delete has no incoming row to read
() => ({ on: 'afterDelete', run: (newRow) => raw`${newRow.body}` }) satisfies TriggerOptions<Post>;

// @ts-expect-error an upsert fires the insert or update triggers, so it names no event of its own
() => ({ on: 'beforeUpsert', run: () => raw`x` }) satisfies TriggerOptions<Post>;

// @ts-expect-error a body is what a trigger runs
() => ({ on: 'afterInsert' }) satisfies TriggerOptions<Post>;

// @ts-expect-error a map has to name at least one engine
() => ({ on: 'afterInsert', run: {} }) satisfies TriggerOptions<Post>;

// @ts-expect-error an engine uql does not render triggers for cannot carry a body
() => ({ on: 'afterInsert', run: { mongodb: () => raw`x` } }) satisfies TriggerOptions<Post>;
