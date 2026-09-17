/**
 * Dependency ordering over any schema object, not just tables: a new kind joins the ordering by
 * describing its edges rather than by adding a branch here.
 */

export type DependenciesOf<N> = (node: N) => Iterable<N>;

/**
 * Nodes in creation order, dependencies first. Cycle-tolerant: a cyclic foreign key is legal SQL,
 * handled by deferring the constraint, so a cycle orders arbitrarily rather than throwing.
 */
export function createOrder<N>(nodes: Iterable<N>, dependenciesOf: DependenciesOf<N>): N[] {
  const ordered: N[] = [];
  const visited = new Set<N>();

  const visit = (node: N): void => {
    if (visited.has(node)) {
      return;
    }
    visited.add(node);
    for (const dependency of dependenciesOf(node)) {
      visit(dependency);
    }
    ordered.push(node);
  };

  for (const node of nodes) {
    visit(node);
  }
  return ordered;
}

/** Nodes in drop order, dependents first. */
export function dropOrder<N>(nodes: Iterable<N>, dependenciesOf: DependenciesOf<N>): N[] {
  return createOrder(nodes, dependenciesOf).reverse();
}
