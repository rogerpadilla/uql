/**
 * Defines the naming strategy for database tables and columns.
 */
export interface NamingStrategy {
  /**
   * Translates entity name to table name.
   */
  tableName(entityName: string): string;
  /**
   * Translates property name to column name.
   */
  columnName(propertyName: string): string;
  /**
   * Translates entity names to join table name (many-to-many).
   */
  joinTableName(sourceEntityName: string, targetEntityName: string, propertyName?: string): string;
}
