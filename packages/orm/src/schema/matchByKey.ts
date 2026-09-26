/**
 * The only three ways two keyed collections can differ, which is the shape of every comparison in
 * the schema diff: tables, columns, indexes and relationships all key and then split the same way.
 * One counterpart each, so two items sharing a key (a duplicate index) are not collapsed into one.
 */
export function matchByKey<S, T>(source: Iterable<S>, target: Iterable<T>, key: (item: S | T) => string) {
  const unpaired = Map.groupBy(target, key);
  const created: S[] = [];
  const matched: (readonly [S, T])[] = [];
  for (const item of source) {
    const counterpart = unpaired.get(key(item))?.shift();
    if (counterpart === undefined) created.push(item);
    else matched.push([item, counterpart]);
  }
  return { created, dropped: [...unpaired.values()].flat(), matched };
}

/**
 * What {@link matchByKey} left unpaired, paired where `same` finds exactly one counterpart on each side:
 * an item two others could be is ambiguous, so it stays created or dropped.
 */
export function pairUnique<S, T>(
  created: readonly S[],
  dropped: readonly T[],
  same: (source: S, target: T) => boolean,
) {
  const matched = created.flatMap((source) => {
    const [target, ...others] = dropped.filter((candidate) => same(source, candidate));
    return target !== undefined && !others.length && created.filter((other) => same(other, target)).length === 1
      ? [[source, target] as const]
      : [];
  });
  const paired = new Set<S | T>(matched.flat());
  return {
    created: created.filter((item) => !paired.has(item)),
    dropped: dropped.filter((item) => !paired.has(item)),
    matched,
  };
}
