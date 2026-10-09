import { asyncScope } from '../context/context.js';
import type { Querier } from '../type/index.js';

/**
 * A transaction as the flow running its callback holds it: the querier it runs on, the slot of that querier's
 * connection, the one it is nested in, the callbacks to run once the outermost commits, and its own nested
 * transactions, run one at a time.
 */
export type TransactionScope = {
  readonly querier: Querier;
  readonly slot: TransactionSlot;
  readonly parent: TransactionScope | undefined;
  readonly onCommit: (() => unknown)[];
  nested: Promise<unknown>;
};

/**
 * The transaction a connection holds, shared by every querier on it. `manual` is a `beginTransaction` with no
 * callback, so every statement of its querier is inside it, whatever flow sends it.
 */
export type TransactionSlot = {
  held?: { readonly scope: TransactionScope; readonly manual: boolean; readonly ended: Promise<void>; end(): void };
};

const slots = new WeakMap<object, TransactionSlot>();

/** The slot of `connection`, whichever querier on it asks. */
export function slotOf(connection: object): TransactionSlot {
  let slot = slots.get(connection);
  if (!slot) {
    slot = {};
    slots.set(connection, slot);
  }
  return slot;
}

/**
 * Waits until `slot` holds no transaction, then holds it for `scope`, the root of its own, until {@link free}:
 * in the turn it found it free, so two waiting never both take it.
 */
export async function claim(slot: TransactionSlot, scope: TransactionScope, manual: boolean): Promise<void> {
  while (slot.held) {
    await slot.held.ended;
  }
  const { promise: ended, resolve: end } = Promise.withResolvers<void>();
  slot.held = { scope, manual, ended, end };
}

/** Ends the transaction `slot` holds, waking whoever waits for it. */
export function free(slot: TransactionSlot): void {
  const { held } = slot;
  slot.held = undefined;
  held?.end();
}

/** Waits until `slot` holds no transaction, or one `isMine` says the waiting flow runs in. */
export async function awaitTurn(slot: TransactionSlot, isMine: () => boolean): Promise<void> {
  while (slot.held && !isMine()) {
    await slot.held.ended;
  }
}

const transactions = asyncScope<TransactionScope>();

/**
 * The scope of the transaction callback the active flow runs in, the innermost where they nest, while its
 * connection still holds it: a timer or promise the callback left running outlives it.
 */
export function currentTransaction(): TransactionScope | undefined {
  const scope = transactions.get();
  return scope && scope.slot.held?.scope === rootOf(scope) ? scope : undefined;
}

/** Runs `callback` inside `scope`, which statements, nested transactions and pool calls read as theirs. */
export function inTransaction<T>(scope: TransactionScope, callback: () => T): T {
  return transactions.run(scope, callback);
}

export function newScope(querier: Querier, slot: TransactionSlot, parent?: TransactionScope): TransactionScope {
  return { querier, slot, parent, onCommit: [], nested: Promise.resolve() };
}

export function rootOf(scope: TransactionScope): TransactionScope {
  return scope.parent ? rootOf(scope.parent) : scope;
}

export function depthOf(scope: TransactionScope): number {
  return scope.parent ? depthOf(scope.parent) + 1 : 0;
}
