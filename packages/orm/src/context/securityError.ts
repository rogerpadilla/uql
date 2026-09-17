/** Thrown when a `security` filter can't resolve its condition - fails the query closed. */
export class UqlSecurityError extends Error {
  override name = 'UqlSecurityError';
}
