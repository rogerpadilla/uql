import { describe, expect, it } from 'vitest';
import { createOrder, dropOrder } from './dependencyGraph.js';

/** A graph as an adjacency map, which is all the walk reads. Every node it names is a key. */
const graph = (edges: Record<string, readonly string[]>) => ({
  nodes: Object.keys(edges),
  dependenciesOf: (node: string) => edges[node],
});

describe('dependencyGraph', () => {
  it('should put a dependency before the node that needs it', () => {
    const { nodes, dependenciesOf } = graph({ post: ['user'], user: [] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['user', 'post']);
  });

  it('should order a chain from the far end', () => {
    const { nodes, dependenciesOf } = graph({ comment: ['post'], post: ['user'], user: [] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['user', 'post', 'comment']);
  });

  it('should emit a shared dependency once', () => {
    const { nodes, dependenciesOf } = graph({ post: ['user'], profile: ['user'], user: [] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['user', 'post', 'profile']);
  });

  it('should reach a dependency that is not itself in the node list', () => {
    const { dependenciesOf } = graph({ post: ['user'], user: [] });
    expect(createOrder(['post'], dependenciesOf)).toEqual(['user', 'post']);
  });

  it('should drop dependents before what they depend on', () => {
    const { nodes, dependenciesOf } = graph({ comment: ['post'], post: ['user'], user: [] });
    expect(dropOrder(nodes, dependenciesOf)).toEqual(['comment', 'post', 'user']);
  });

  it('should order a cycle rather than refusing it, since a cyclic FK is legal', () => {
    const { nodes, dependenciesOf } = graph({ a: ['b'], b: ['a'] });
    expect(createOrder(nodes, dependenciesOf)).toEqual(['b', 'a']);
  });

  it('should return nothing for an empty graph', () => {
    expect(createOrder([], () => [])).toEqual([]);
  });
});
