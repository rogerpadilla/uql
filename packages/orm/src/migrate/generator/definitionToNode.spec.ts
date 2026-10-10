import { describe, expect, it } from 'vitest';
import { sql } from '../../util/index.js';
import { derivedIndexName } from '../../util/sql.util.js';
import { indexDefinition, renderIndexDefinition } from './definitionToNode.js';

const renders = (predicate: string) => () => predicate;

describe('renderIndexDefinition', () => {
  it('should name an unnamed partial index by a hash of its rendered predicate, as an entity does', () => {
    const index = indexDefinition(['total'], { where: sql`live` });

    expect(renderIndexDefinition('Order', index, renders('live')).name).toBe(
      derivedIndexName('Order', ['total'], false, 'live'),
    );
  });

  it('should name a predicate-less index by its columns alone, and a rendered one differently', () => {
    const index = indexDefinition(['total', 'status']);

    expect(renderIndexDefinition('Order', index, renders('')).name).toBe('Order__total_status_idx');
    expect(renderIndexDefinition('Order', indexDefinition(['total']), renders('')).name).toBe('Order__total_idx');
    expect(renderIndexDefinition('Order', { ...index, where: sql`live` }, renders('live')).name).not.toBe(
      'Order__total_idx',
    );
  });

  it('should name a unique table index by its kind, and a declared name as declared', () => {
    const unique = indexDefinition(['total'], {}, true);
    const named = indexDefinition(['total'], { name: 'by_total' });

    expect(renderIndexDefinition('Order', unique, renders('')).name).toBe('Order__total_uk');
    expect(renderIndexDefinition('Order', named, renders('')).name).toBe('by_total');
  });
});
