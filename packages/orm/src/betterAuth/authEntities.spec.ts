import type { BetterAuthOptions } from 'better-auth';
import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { authEntities } from './authEntities.js';

/**
 * An OAuth client, and a grant pointing at it by its public id rather than its key, as Better Auth's
 * OAuth provider plugin declares its tables.
 */
const oauth = {
  plugins: [
    {
      id: 'oauth',
      schema: {
        oauthClient: {
          modelName: 'oauthClient',
          fields: {
            clientId: { type: 'string', unique: true },
            scopes: { type: ['read', 'write'], required: false },
            active: { type: 'boolean', defaultValue: true },
          },
        },
        oauthGrant: {
          modelName: 'oauthGrant',
          fields: {
            clientId: { type: 'string', references: { model: 'oauthClient', field: 'clientId' } },
            userId: { type: 'string', references: { model: 'user', field: 'id', onDelete: 'set null' } },
            scope: { type: 'string' },
          },
          indexes: [{ fields: ['clientId', 'scope'], unique: true }],
        },
      },
    },
  ],
} satisfies BetterAuthOptions;

/** The metadata of the table `name` these options define. */
function tableOf(options: BetterAuthOptions, name: string) {
  const entity = authEntities(options).find((it) => getMeta(it).name === name);
  if (!entity) {
    throw new Error(`no table '${name}'`);
  }
  return getMeta(entity);
}

describe('authEntities', () => {
  it('should hold every reference as a foreign key, deleting in cascade unless it says otherwise', () => {
    const grant = tableOf(oauth, 'oauthGrant');

    expect(grant.relations['clientIdRef']).toMatchObject({
      cardinality: 'm1',
      references: [{ local: 'clientId', foreign: 'clientId' }],
      onDelete: 'CASCADE',
    });
    expect(grant.relations['userIdRef']).toMatchObject({
      references: [{ local: 'userId', foreign: 'id' }],
      onDelete: 'SET NULL',
    });
  });

  it('should store text as text, and as an indexable string where something indexes it', () => {
    const grant = tableOf(oauth, 'oauthGrant');

    expect(grant.fields['scope']?.type).toBe('text');
    expect(grant.fields['clientId']?.type).toBe(String);
  });

  it('should store a list of allowed values as text, which Better Auth checks itself', () => {
    const scopes = tableOf(oauth, 'oauthClient').fields['scopes'];

    expect(scopes?.type).toBe('text');
    expect(scopes?.enum).toBeUndefined();
  });

  it('should give a column a plain default, so one added to rows that exist has one to fill', () => {
    expect(tableOf(oauth, 'oauthClient').fields['active']?.defaultValue).toBe(true);
  });

  it('should resolve a reference by its table name as well as by its key, as Better Auth does', () => {
    const options = {
      plugins: [
        {
          id: 'renamed',
          schema: {
            client: { modelName: 'oauth_client', fields: { clientId: { type: 'string', unique: true } } },
            grant: {
              fields: { clientId: { type: 'string', references: { model: 'oauth_client', field: 'clientId' } } },
            },
          },
        },
      ],
    } satisfies BetterAuthOptions;

    expect(tableOf(options, 'grant').relations['clientIdRef']?.entity()).toBe(tableOf(options, 'oauth_client').entity);
  });

  it('should give a nullable unique column no default, NULL being the only backfill two rows can share', () => {
    const options = {
      plugins: [
        {
          id: 'handles',
          schema: {
            handle: { fields: { slug: { type: 'string', unique: true, required: false, defaultValue: 'x' } } },
          },
        },
      ],
    } satisfies BetterAuthOptions;

    expect(tableOf(options, 'handle').fields['slug']?.defaultValue).toBeUndefined();
  });

  it('should declare a compound index', () => {
    expect(tableOf(oauth, 'oauthGrant').indexes).toEqual([
      expect.objectContaining({ columns: [{ column: 'clientId' }, { column: 'scope' }], unique: true }),
    ]);
  });

  it('should define equal tables once, as the same entities', () => {
    expect(authEntities({ ...oauth })).toEqual(authEntities(oauth));
  });

  it('should refuse a key it would have to guess the type of', () => {
    const options = { advanced: { database: { generateId: false } } } satisfies BetterAuthOptions;

    expect(() => authEntities(options)).toThrow("'generateId: false' leaves the key to the database");
  });

  it('should refuse a reference to a column its table does not have', () => {
    const options = {
      plugins: [
        {
          id: 'broken',
          schema: {
            grant: { fields: { clientId: { type: 'string', references: { model: 'user', field: 'clientId' } } } },
          },
        },
      ],
    } satisfies BetterAuthOptions;

    expect(() => authEntities(options)).toThrow("references 'user.clientId', which its schema does not have");
  });
});
