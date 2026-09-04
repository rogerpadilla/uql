import { describe, expect, it } from 'vitest';
import { createOrder, dropOrder, findCycles } from './dependencyGraph.js';

/** A graph as an adjacency map, which is all the two walks read. Every node it names is a key. */
const graph = (edges: Record<string, readonly string[]>) => ({
  nodes: Object.keys(edges),
  dependenciesOf: (node: string) => edges[node],
});

describe('dependencyGraph', () => {
  it('puts a dependency before the node that needs it', () => {
    const { nodes, dependenciesOf } = graph({ post: ['user'], user: [] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['user', 'post']);
  });

  it('orders a chain from the far end', () => {
    const { nodes, dependenciesOf } = graph({ comment: ['post'], post: ['user'], user: [] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['user', 'post', 'comment']);
  });

  it('emits a shared dependency once', () => {
    const { nodes, dependenciesOf } = graph({ post: ['user'], profile: ['user'], user: [] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['user', 'post', 'profile']);
  });

  it('reaches a dependency that is not itself in the node list', () => {
    const { dependenciesOf } = graph({ post: ['user'], user: [] });
    expect(createOrder(['post'], dependenciesOf)).toEqual(['user', 'post']);
  });

  it('drops dependents before what they depend on', () => {
    const { nodes, dependenciesOf } = graph({ comment: ['post'], post: ['user'], user: [] });
    expect(dropOrder(nodes, dependenciesOf)).toEqual(['comment', 'post', 'user']);
  });

  it('orders a cycle rather than refusing it, since a cyclic FK is legal', () => {
    const { nodes, dependenciesOf } = graph({ a: ['b'], b: ['a'] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['b', 'a']);
  });

  it('finds a two-node cycle', () => {
    const { nodes, dependenciesOf } = graph({ a: ['b'], b: ['a'] });
    expect(findCycles(nodes, dependenciesOf)).toEqual([['a', 'b']]);
  });

  it('finds a self-reference', () => {
    const { nodes, dependenciesOf } = graph({ a: ['a'] });
    expect(findCycles(nodes, dependenciesOf)).toEqual([['a']]);
  });

  it('finds no cycle in a diamond, which is not one', () => {
    const { nodes, dependenciesOf } = graph({ d: ['b', 'c'], b: ['a'], c: ['a'], a: [] });
    expect(findCycles(nodes, dependenciesOf)).toEqual([]);
  });

  it('returns nothing for an empty graph', () => {
    expect(createOrder([], () => [])).toEqual([]);
    expect(findCycles([], () => [])).toEqual([]);
  });
});
