import { expect } from 'vitest';
import { CrdbQuerierPool } from '../../cockroachdb/crdbQuerierPool.js';
import { cockroachConnection, createSpec } from '../../test/index.js';
import { raw } from '../../util/raw.js';
import { AbstractIntrospectorIt } from './abstractIntrospector-test.js';

/** CockroachDB answers the Postgres catalogue queries; what needs its own reading is where the two differ. */
class CockroachIntrospectorIt extends AbstractIntrospectorIt {
  /** CockroachDB reprints a string holding a quote in escape syntax, `e'it\'s'`. */
  async shouldReadAStringDefaultHoldingAQuoteBackAsWritten() {
    const schema = await this.probe('probe_quoted', (querier, table) =>
      querier.run(raw.text(`CREATE TABLE ${table} (id INT PRIMARY KEY, label STRING DEFAULT 'it''s')`)),
    );

    expect(this.getColumn(schema, 'label').defaultValue).toBe("it's");
  }

  /**
   * CockroachDB reports every index's access method as `prefix` and no operator class, so a vector index,
   * its distance and its prefix columns are read off its definition instead: its distance is what its class
   * names, or else the default L2.
   */
  async shouldReadAVectorIndexOffItsDefinition() {
    const schema = await this.probe('probe_vector', async (querier, table) => {
      await querier.run(
        raw.text(`CREATE TABLE ${table} (id INT PRIMARY KEY, k INT, v VECTOR(3), w VECTOR(3), t STRING)`),
      );
      await querier.run(raw.text(`CREATE VECTOR INDEX crdb_vec_cosine ON ${table} (k, v vector_cosine_ops)`));
      await querier.run(raw.text(`CREATE VECTOR INDEX crdb_vec_default ON ${table} (w)`));
      await querier.run(raw.text(`CREATE INDEX crdb_plain ON ${table} (t)`));
    });

    expect(schema.indexes?.map(({ name, type, distance, entries }) => ({ name, type, distance, entries }))).toEqual([
      { name: 'crdb_plain', type: undefined, distance: undefined, entries: [{ column: 't', order: 'asc' }] },
      {
        name: 'crdb_vec_cosine',
        type: 'vector',
        distance: 'cosine',
        entries: [
          { column: 'k', order: 'asc' },
          { column: 'v', order: 'asc' },
        ],
      },
      { name: 'crdb_vec_default', type: 'vector', distance: 'l2', entries: [{ column: 'w', order: 'asc' }] },
    ]);
  }
}

createSpec(new CockroachIntrospectorIt(new CrdbQuerierPool(cockroachConnection('test_introspector'))));
