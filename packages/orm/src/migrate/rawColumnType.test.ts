import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { PgQuerierPool } from '../postgres/pgQuerierPool.js';
import { postgresConnection } from '../test/index.js';
import { syncedPool } from '../test/sqlPools.js';
import { raw } from '../util/index.js';
import { Migrator } from './migrator.js';

const TABLE = 'RawColumnTypeCaption';

/**
 * An engine's own type, which uql models no family for, carrying the search vector a full-text query
 * ranks by. Only Postgres is driven here: every dialect renders a column type through `canonicalToSql`,
 * which returns a raw one verbatim before any engine mapping is consulted.
 */
@Index((caption) => [caption.searchVector], { name: 'rct_search_idx', type: 'gin' })
@Entity({ name: TABLE })
class Caption {
  @Id({ type: Number }) id?: number;

  @Field({ type: String }) text?: string | null;

  @Field({
    type: String,
    columnType: raw`tsvector`,
    computed: (caption) => raw`to_tsvector('simple', coalesce(${caption.text}, ''))`,
    stored: true,
    eager: false,
  })
  readonly searchVector?: string | null;
}

describe('a raw column type (PostgreSQL)', () => {
  const pool = syncedPool(() => new PgQuerierPool(postgresConnection()), [Caption]);

  it('should create the column as the engine spells it', async () => {
    const [column] = await pool().all<{ data_type: string }>(
      raw.text(
        `SELECT data_type FROM information_schema.columns WHERE table_name = '${TABLE}' AND column_name = 'searchVector'`,
      ),
    );
    expect(column.data_type).toBe('tsvector');
  });

  it('should keep the generated expression the engine fills', async () => {
    await pool().insertOne(Caption, { text: 'la reunión del proyecto' });
    const [row] = await pool().all<{ hit: boolean }>(
      raw.text(`SELECT "searchVector" @@ to_tsquery('simple', 'proyecto') AS hit FROM "${TABLE}"`),
    );
    expect(row.hit).toBe(true);
  });

  it('should index it, which is why the column needs the engine type and not a text one', async () => {
    const indexes = await pool().all<{ indexname: string }>(
      raw.text(`SELECT indexname FROM pg_indexes WHERE tablename = '${TABLE}' ORDER BY indexname`),
    );
    expect(indexes).toEqual([{ indexname: `${TABLE}__id_pk` }, { indexname: 'rct_search_idx' }]);
  });

  // The entity renders `tsvector` and the catalogue reports `tsvector`, so neither side translates it.
  it('should report no drift against the schema it just created', async () => {
    expect(await new Migrator(pool(), { entities: [Caption] }).planSync({ safe: false })).toEqual([]);
  });
});
