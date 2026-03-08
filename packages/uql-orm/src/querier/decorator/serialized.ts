/**
 * Decorator that ensures the decorated method is executed serially within the Querier instance.
 * It uses a private promise queue to prevent race conditions on the database connection.
 * Note: The decorated class must extend AbstractQuerier or implement a compatible serialize method.
 */
export function Serialized() {
  return (_target: object, _key: string, propDescriptor: PropertyDescriptor): void => {
    const originalMethod = propDescriptor.value;
    propDescriptor.value = function (this: any, ...args: any[]) {
      return this.serialize(() => originalMethod.apply(this, args));
    };
  };
}
