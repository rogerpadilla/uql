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
