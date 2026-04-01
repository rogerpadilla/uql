import { MongoDialect } from './mongoDialect.js';

/**
 * MongoDB Dialect specialization for the official `mongodb` driver.
 *
 * @remarks Empty subclass by design: distinct type for `MongodbQuerierPool` and a hook
 * for future driver-specific behavior.
 */
export class MongodbNativeDialect extends MongoDialect {}
