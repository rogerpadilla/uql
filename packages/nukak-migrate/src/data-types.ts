import util from 'node:util';
import type { Class } from 'type-fest';

import { joinSQLFragments } from './utils/join-sql-fragments.js';
import { parseNumber } from './utils/parse-number.js';
import { makeBufferFromTypedArray } from './utils/buffer.js';
import { attributeTypeToSql, dataTypeClassOrInstanceToInstance, isDataType } from './data-types-utils.js';
import { Falsy } from './utils/types.js';
import { formatAsDateOnly } from './utils/date.helper.js';
import { isObject, isString } from './utils/object.js';

// If T is a constructor, returns the type of what `new T()` would return,
// otherwise, returns T
export type Constructed<T> = T extends abstract new () => infer Instance ? Instance : T;

export type AcceptableTypeOf<T extends DataType> = Constructed<T> extends AbstractDataType<infer Acceptable>
  ? Acceptable
  : never;

export type DataTypeInstance = AbstractDataType<any>;
export type DataTypeClass = Class<AbstractDataType<any>>;

export type DataTypeClassOrInstance = DataTypeInstance | DataTypeClass;

export type DataType = string | DataTypeClassOrInstance;

export type NormalizedDataType = string | DataTypeInstance;

export interface BindParamOptions {
  bindParam(value: unknown): string;
}

/**
 * A symbol that can be used as the key for a static property on a DataType class to uniquely identify it.
 */
const kDataTypeIdentifier = Symbol('sequelize.DataTypeIdentifier');

/**
 * @category DataTypes
 */
export abstract class AbstractDataType<
  /** The type of value we'll accept - ie for a column of this type, we'll accept this value as user input. */
  AcceptedType,
> {
  /**
   * This property is designed to uniquely identify the DataType.
   * Do not change this value in implementation-specific dialects, or they will not be mapped to their parent DataType properly!
   *
   * @hidden
   */
  declare static readonly [kDataTypeIdentifier]: string;

  readonly acceptsNull?: boolean;

  get dataTypeId(): string {
    return AbstractDataType[kDataTypeIdentifier];
  }

  // TODO: move to utils?
  protected _construct<Constructor extends abstract new () => AbstractDataType<any>>(
    ...args: ConstructorParameters<Constructor>
  ): this {
    const constructor = this.constructor as new (..._args: ConstructorParameters<Constructor>) => this;
    return new constructor(...args);
  }

  /**
   * Called when a value is retrieved from the Database, and its DataType is specified.
   * Used to normalize values from the database.
   *
   * Note: It is also possible to do an initial parsing of a Database value using {@link AbstractDialect#registerDataTypeParser}.
   * That normalization uses the type ID from the database instead of a Sequelize Data Type to determine which parser to use,
   * and is called before this method.
   *
   * @param value The value to parse.
   */
  parseDatabaseValue(value: unknown): unknown {
    return value as AcceptedType;
  }

  /**
   * Used to normalize a value when {@link Model#set} is called.
   * That is, when a user sets a value on a Model instance.
   *
   * @param value
   */
  sanitize(value: unknown): unknown {
    return value;
  }

  /**
   * Converts a JS value to a value compatible with the connector library for this Data Type.
   * Unlike {@link escape}, this value does not need to be escaped. It is passed separately to the database, which
   * will handle escaping.
   *
   * @param value The value to convert.
   */
  toBindableValue(value: AcceptedType): unknown {
    return String(value);
  }

  toString(): string {
    try {
      return this.sql;
    } catch {
      // best effort introspection (dialect may not be available)
      return this.constructor.toString();
    }
  }

  /**
   * Returns a SQL declaration of this data type.
   * e.g. 'VARCHAR(255)', 'TEXT', etc…
   */
  get sql(): string {
    return this.dataTypeId;
  }
}

export interface StringTypeOptions {
  /**
   * @default 255
   */
  length?: number | undefined;

  /**
   * @default false
   */
  binary?: boolean;
}

/**
 * Represents a variable length string type.
 *
 * __Fallback policy:__
 * - If the 'length' option is not supported by the dialect, a CHECK constraint will be added to ensure
 * the value remains within the specified length.
 * - If the 'binary' option is not supported by the dialect, a suitable binary type will be used instead.
 *   If none is available, an error will be raised instead.
 *
 * @example
 * ```ts
 * DataTypes.STRING(255)
 * ```
 *
 * @category DataTypes
 */
export class STRING extends AbstractDataType<string | Buffer> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'STRING';
  readonly options: StringTypeOptions;

  constructor(length: number, binary?: boolean);
  constructor(options?: StringTypeOptions);
  // we have to define the constructor overloads using tuples due to a TypeScript limitation
  //  https://github.com/microsoft/TypeScript/issues/29732, to play nice with classToInvokable.
  /** @hidden */
  constructor(...args: [] | [length: number] | [length: number, binary: boolean] | [options: StringTypeOptions]);

  constructor(lengthOrOptions?: number | StringTypeOptions, binary?: boolean) {
    super();

    if (isObject(lengthOrOptions)) {
      this.options = {
        length: lengthOrOptions.length,
        binary: lengthOrOptions.binary ?? false,
      };
    } else {
      this.options = {
        length: lengthOrOptions,
        binary: binary ?? false,
      };
    }
  }

  override get sql(): string {
    // TODO: STRING should use an unlimited length type by default - https://github.com/sequelize/sequelize/issues/14259
    return joinSQLFragments([`VARCHAR(${this.options.length ?? 255})`, this.options.binary && 'BINARY']);
  }

  get BINARY() {
    return this._construct<typeof STRING>({
      ...this.options,
      binary: true,
    });
  }

  static get BINARY() {
    return new this({ binary: true });
  }
}

/**
 * Represents a fixed length string type.
 *
 * __Fallback policy:__
 * - If this DataType is not supported, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.CHAR(1000)
 * ```
 *
 * @category DataTypes
 */
export class CHAR extends STRING {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'CHAR';

  override get sql() {
    return joinSQLFragments([`CHAR(${this.options.length ?? 255})`, this.options.binary && 'BINARY']);
  }
}

const validTextLengths = ['tiny', 'medium', 'long'];
export type TextLength = 'tiny' | 'medium' | 'long';

export interface TextOptions {
  length?: TextLength | undefined;
}

/**
 * Represents an unlimited length string type.
 *
 * @example
 * ```ts
 * DataTypes.TEXT('tiny') // TINYTEXT
 * ```
 *
 * @category DataTypes
 */
export class TEXT extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'TEXT';
  readonly options: TextOptions;

  /**
   * @param lengthOrOptions could be tiny, medium, long.
   */
  constructor(lengthOrOptions?: TextLength | TextOptions) {
    super();

    const length = (typeof lengthOrOptions === 'object' ? lengthOrOptions.length : lengthOrOptions)?.toLowerCase();

    if (length != null && !validTextLengths.includes(length)) {
      throw new TypeError(`If specified, the "length" option must be one of: ${validTextLengths.join(', ')}`);
    }

    this.options = {
      length: length as TextLength,
    };
  }

  override get sql(): string {
    switch (this.options.length) {
      case 'tiny':
        return 'TINYTEXT';
      case 'medium':
        return 'MEDIUMTEXT';
      case 'long':
        return 'LONGTEXT';
      default:
        return 'TEXT';
    }
  }
}

/**
 * An unlimited length case-insensitive text column.
 * Original case is preserved but acts case-insensitive when comparing values (such as when finding or unique constraints).
 * Only available in Postgres and SQLite.
 *
 * __Fallback policy:__
 * - If this DataType is not supported, and no case-insensitive text alternative exists, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.CITEXT
 * ```
 *
 * @category DataTypes
 */
export class CITEXT extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'CITEXT';
}

export interface NumberOptions {
  /**
   * Pad the value with zeros to the specified length.
   *
   * Currently useless for types that are returned as JS BigInts or JS Numbers.
   */
  // TODO: When a number is 0-filled, return it as a string instead of number or bigint
  zerofill?: boolean | undefined;

  /**
   * Is unsigned?
   */
  unsigned?: boolean | undefined;
}

export interface IntegerOptions extends NumberOptions {
  /**
   * In MariaDB: When specified, and {@link zerofill} is set, the returned value will be padded with zeros to the specified length.
   * In MySQL: This option is ignored.
   * This option is supported in no other dialect.
   * Currently useless for types that are returned as JS BigInts or JS Numbers.
   */
  length?: number;
}

export interface DecimalNumberOptions extends NumberOptions {
  /**
   * Total number of digits.
   *
   * {@link DecimalNumberOptions#scale} must be specified if precision is specified.
   */
  precision?: number | undefined;

  /**
   * Count of decimal digits in the fractional part.
   *
   * {@link DecimalNumberOptions#precision} must be specified if scale is specified.
   */
  scale?: number | undefined;
}

type AcceptedNumber = number | bigint | boolean | string | null;

/**
 * Base number type which is used to build other types
 */
export class BaseNumberDataType<
  Options extends NumberOptions = NumberOptions,
> extends AbstractDataType<AcceptedNumber> {
  readonly options: Options;

  constructor(options?: Options) {
    super();

    this.options = { ...options };
  }

  protected get numberSqlTypeName(): string {
    return this.dataTypeId;
  }

  override get sql(): string {
    let result = this.numberSqlTypeName;

    if (this.options.unsigned) {
      result += ' UNSIGNED';
    }

    if (this.options.zerofill) {
      result += ' ZEROFILL';
    }

    return result;
  }

  override toBindableValue(num: AcceptedNumber): string | number {
    if (Number.isNaN(num)) {
      return 'NaN';
    }

    if (num === Number.NEGATIVE_INFINITY || num === Number.POSITIVE_INFINITY) {
      const sign = num < 0 ? '-' : '';

      return `${sign}Infinity`;
    }

    if (typeof num === 'boolean') {
      return num ? 1 : 0;
    }

    if (typeof num === 'bigint') {
      return num.toString();
    }

    return num;
  }

  getBindParamSql(value: AcceptedNumber, options: BindParamOptions): string {
    return options.bindParam(value);
  }

  get UNSIGNED(): this {
    return this._construct<typeof BaseNumberDataType>({ ...this.options, unsigned: true });
  }

  get ZEROFILL(): this {
    return this._construct<typeof BaseNumberDataType>({ ...this.options, zerofill: true });
  }

  static get UNSIGNED() {
    return new this({ unsigned: true });
  }

  static get ZEROFILL() {
    return new this({ zerofill: true });
  }
}

export class BaseIntegerDataType extends BaseNumberDataType<IntegerOptions> {
  constructor(optionsOrLength?: number | Readonly<IntegerOptions>) {
    if (typeof optionsOrLength === 'number') {
      super({ length: optionsOrLength });
    } else {
      super(optionsOrLength ?? {});
    }
  }

  override sanitize(value: unknown): unknown {
    if (typeof value === 'string' || typeof value === 'bigint') {
      const out = parseNumber(value);
      return out;
    }
    return value;
  }

  override parseDatabaseValue(value: unknown): unknown {
    return this.sanitize(value);
  }

  override get sql(): string {
    let result = this.numberSqlTypeName;
    if (this.options.length != null) {
      result += `(${this.options.length})`;
    }
    if (this.options.unsigned) {
      result += ' UNSIGNED';
    }
    if (this.options.zerofill) {
      result += ' ZEROFILL';
    }
    return result;
  }
}

/**
 * An 8-bit integer.
 *
 * __Fallback policy:__
 * - If this type or its unsigned option is unsupported by the dialect, it will be replaced by a SMALLINT or greater,
 *   with a CHECK constraint to ensure the value is withing the bounds of an 8-bit integer.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the length option is unsupported by the dialect, it will be discarded.
 *
 * @example
 * ```ts
 * DataTypes.TINYINT
 * ```
 *
 * @category DataTypes
 */
export class TINYINT extends BaseIntegerDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'TINYINT';
}

/**
 * A 16-bit integer.
 *
 * __Fallback policy:__
 * - If this type or its unsigned option is unsupported by the dialect, it will be replaced by a MEDIUMINT or greater,
 *   with a CHECK constraint to ensure the value is withing the bounds of an 16-bit integer.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the length option is unsupported by the dialect, it will be discarded.
 *
 * @example
 * ```ts
 * DataTypes.SMALLINT
 * ```
 *
 * @category DataTypes
 */
export class SMALLINT extends BaseIntegerDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'SMALLINT';
}

/**
 * A 24-bit integer.
 *
 * __Fallback policy:__
 * - If this type or its unsigned option is unsupported by the dialect, it will be replaced by a INTEGER (32 bits) or greater,
 *   with a CHECK constraint to ensure the value is withing the bounds of an 32-bit integer.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the length option is unsupported by the dialect, it will be discarded.
 *
 * @example
 * ```ts
 * DataTypes.MEDIUMINT
 * ```
 *
 * @category DataTypes
 */
export class MEDIUMINT extends BaseIntegerDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'MEDIUMINT';
}

/**
 * A 32-bit integer.
 *
 * __Fallback policy:__
 * - When this type or its unsigned option is unsupported by the dialect, it will be replaced by a BIGINT,
 *   with a CHECK constraint to ensure the value is withing the bounds of an 32-bit integer.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the length option is unsupported by the dialect, it will be discarded.
 *
 * @example
 * ```ts
 * DataTypes.INTEGER
 * ```
 *
 * @category DataTypes
 */
export class INTEGER extends BaseIntegerDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'INTEGER';
}

/**
 * A 64-bit integer.
 *
 * __Fallback policy:__
 * - If this type or its unsigned option is unsupported by the dialect, an error will be raised.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the length option is unsupported by the dialect, it will be discarded.
 *
 * @example
 * ```ts
 * DataTypes.BIGINT
 * ```
 *
 * @category DataTypes
 */
export class BIGINT extends BaseIntegerDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'BIGINT';

  override sanitize(value: AcceptedNumber): AcceptedNumber {
    if (typeof value === 'bigint') {
      return value;
    }
    return BigInt(value);
  }
}

export class BaseDecimalNumberDataType extends BaseNumberDataType<DecimalNumberOptions> {
  constructor(options?: DecimalNumberOptions);
  /**
   * @param precision defines precision
   * @param scale defines scale
   */
  constructor(precision: number, scale: number);

  // we have to define the constructor overloads using tuples due to a TypeScript limitation
  //  https://github.com/microsoft/TypeScript/issues/29732, to play nice with classToInvokable.
  /** @hidden */
  constructor(...args: [] | [precision: number] | [precision: number, scale: number] | [options: DecimalNumberOptions]);

  constructor(precisionOrOptions?: number | DecimalNumberOptions, scale?: number) {
    if (isObject(precisionOrOptions)) {
      super(precisionOrOptions);
    } else {
      super({});

      this.options.precision = precisionOrOptions;
      this.options.scale = scale;
    }

    if (this.options.scale != null && this.options.precision == null) {
      throw new Error(
        `The ${this.dataTypeId} DataType requires that the "precision" option be specified if the "scale" option is specified.`,
      );
    }

    if (this.options.scale == null && this.options.precision != null) {
      throw new Error(
        `The ${this.dataTypeId} DataType requires that the "scale" option be specified if the "precision" option is specified.`,
      );
    }
  }

  isUnconstrained() {
    return this.options.scale == null && this.options.precision == null;
  }

  override get sql(): string {
    let sql = this.numberSqlTypeName;
    if (!this.isUnconstrained()) {
      sql += `(${this.options.precision}, ${this.options.scale})`;
    }
    if (this.options.unsigned) {
      sql += ' UNSIGNED';
    }
    if (this.options.zerofill) {
      sql += ' ZEROFILL';
    }
    return sql;
  }
}

/**
 * A single-floating point number with a 4-byte precision.
 * If single-precision floating-point format is not supported, a double-precision floating-point number may be used instead.
 *
 * __Fallback policy:__
 * - If the precision or scale options are unsupported by the dialect, they will be discarded.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the unsigned option is unsupported, it will be replaced by a CHECK > 0 constraint.
 *
 * @example
 * ```ts
 * DataTypes.FLOAT
 * ```
 *
 * @category DataTypes
 */
export class FLOAT extends BaseDecimalNumberDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'FLOAT';

  protected override get numberSqlTypeName(): string {
    throw new Error(`getNumberSqlTypeName is not implemented by default in the FLOAT DataType because 'float' has very different meanings in different dialects.
DataTypes.FLOAT must be a single-precision floating point, and DataTypes.DOUBLE must be a double-precision floating point.
Please override this method in your dialect, and provide the best available type for single-precision floating points.
If single-precision floating points are not available in your dialect, you may return a double-precision floating point type instead, as long as you print a warning.
If neither single precision nor double precision IEEE 754 floating point numbers are available in your dialect, you must throw an error in the _checkOptionSupport method.`);
  }
}

/**
 * Floating point number (8-byte precision).
 * Throws an error when unsupported, instead of silently falling back to a lower precision.
 *
 * __Fallback policy:__
 * - If the precision or scale options are unsupported by the dialect, they will be discarded.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the unsigned option is unsupported, it will be replaced by a CHECK > 0 constraint.
 *
 * @example
 * ```ts
 * DataTypes.DOUBLE
 * ```
 *
 * @category DataTypes
 */
export class DOUBLE extends BaseDecimalNumberDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'DOUBLE';

  protected override get numberSqlTypeName(): string {
    return 'DOUBLE PRECISION';
  }
}

/**
 * Arbitrary/exact precision decimal number.
 *
 * __Fallback policy:__
 * - If the precision or scale options are unsupported by the dialect, they will be ignored.
 * - If the precision or scale options are not specified, and the dialect does not support unconstrained decimals, an error will be raised.
 * - If the zerofill option is unsupported by the dialect, an error will be raised.
 * - If the unsigned option is unsupported, it will be replaced by a CHECK > 0 constraint.
 *
 * @example
 * ```ts
 * DataTypes.DECIMAL
 * ```
 *
 * @category DataTypes
 */
export class DECIMAL extends BaseDecimalNumberDataType {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'DECIMAL';

  override sanitize(value: AcceptedNumber): AcceptedNumber {
    if (typeof value === 'number') {
      // Some dialects support NaN
      if (Number.isNaN(value)) {
        return value;
      }

      // catch loss of precision issues
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new Error(
          `${this.dataTypeId} received an integer ${util.inspect(
            value,
          )} that is not a safely represented using the JavaScript number type. Use a JavaScript bigint or a string instead.`,
        );
      }
    }

    // Decimal is arbitrary precision, and *must* be represented as strings, as the JS number type does not support arbitrary precision.
    return String(value);
  }
}

/**
 * A boolean / tinyint column, depending on dialect
 *
 * __Fallback policy:__
 * - If a native boolean type is not available, a dialect-specific numeric replacement (bit, tinyint) will be used instead.
 *
 * @example
 * ```ts
 * DataTypes.BOOLEAN
 * ```
 *
 * @category DataTypes
 */
export class BOOLEAN extends AbstractDataType<boolean> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'BOOLEAN';

  override get sql() {
    // Note: This may vary depending on the dialect.
    return 'BOOLEAN';
  }

  override parseDatabaseValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    // Some dialects do not have a dedicated boolean type. We receive integers instead.
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }

    // Some dialects also use BIT for booleans, which produces a Buffer.
    if (Buffer.isBuffer(value) && value.length === 1) {
      if (value[0] === 1) {
        return true;
      }

      if (value[0] === 0) {
        return false;
      }
    }

    throw new TypeError(`Received invalid boolean value from DB: ${util.inspect(value)}`);
  }

  override toBindableValue(value: boolean | Falsy): unknown {
    return Boolean(value);
  }
}

export interface TimeOptions {
  /**
   * The precision of the date.
   */
  precision?: number | undefined;
}

/**
 * A time column.
 *
 * __Fallback policy:__
 * If the dialect does not support this type natively, it will be replaced by a string type,
 * and a CHECK constraint to enforce a valid ISO 8601 time format.
 *
 * @example
 * ```ts
 * DataTypes.TIME(3)
 * ```
 *
 * @category DataTypes
 */
export class TIME extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'TIME';
  readonly options: TimeOptions;

  /**
   * @param precisionOrOptions precision to allow storing milliseconds
   */
  constructor(precisionOrOptions?: number | TimeOptions) {
    super();

    this.options = {
      precision: typeof precisionOrOptions === 'object' ? precisionOrOptions.precision : precisionOrOptions,
    };
  }

  override get sql() {
    if (this.options.precision != null) {
      return `TIME(${this.options.precision})`;
    }

    return 'TIME';
  }
}

export interface DateOptions {
  /**
   * The precision of the date.
   */
  precision?: number | undefined;
}

type RawDate = Date | string | number;
export type AcceptedDate = RawDate;

/**
 * A date and time.
 *
 * __Fallback policy:__
 * If the dialect does not support this type natively, it will be replaced by a string type,
 * and a CHECK constraint to enforce a valid ISO 8601 date-only format.
 *
 * @example
 * ```ts
 * DataTypes.DATE(3)
 * ```
 *
 * @category DataTypes
 */
export class DATE extends AbstractDataType<AcceptedDate> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'DATE';
  readonly options: DateOptions;

  /**
   * @param precisionOrOptions precision to allow storing milliseconds
   */
  constructor(precisionOrOptions?: number | DateOptions) {
    super();

    this.options = {
      precision: typeof precisionOrOptions === 'object' ? precisionOrOptions.precision : precisionOrOptions,
    };

    if (this.options.precision != null && (this.options.precision < 0 || !Number.isInteger(this.options.precision))) {
      throw new TypeError('Option "precision" must be a positive integer');
    }
  }

  override get sql() {
    // TODO [>=8]: Consider making precision default to 3 instead of being dialect-dependent.
    if (this.options.precision != null) {
      return `DATETIME(${this.options.precision})`;
    }

    return 'DATETIME';
  }

  override sanitize(value: unknown): unknown {
    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    }

    throw new TypeError(
      `${util.inspect(value)} cannot be converted to a Date object, and is not a DayJS nor Moment object`,
    );
  }

  override parseDatabaseValue(value: unknown): unknown {
    return this.sanitize(value);
  }
}

/**
 * A date only column (no timestamp)
 *
 * __Fallback policy:__
 * If the dialect does not support this type natively, it will be replaced by a string type,
 * and a CHECK constraint to enforce a valid ISO 8601 datetime format.
 *
 * @example
 * ```ts
 * DataTypes.DATEONLY
 * ```
 *
 * @category DataTypes
 */
export class DATEONLY extends AbstractDataType<AcceptedDate> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'DATEONLY';

  override get sql() {
    return 'DATE';
  }

  override toBindableValue(date: AcceptedDate) {
    return this.sanitize(date);
  }

  override sanitize(value: unknown): unknown {
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
      throw new TypeError(`${value} cannot be normalized into a DateOnly string.`);
    }
    return formatAsDateOnly(value);
  }
}

/**
 * A JSON string column.
 *
 * __Fallback policy:__
 * If the dialect does not support this type natively, but supports verifying a string as is valid JSON through CHECK constraints,
 * that will be used instead.
 * If neither are available, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.JSON
 * ```
 *
 * @category DataTypes
 */
export class JSON extends AbstractDataType<any> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'JSON';

  override acceptsNull = true;

  override toBindableValue(value: any): string {
    return globalThis.JSON.stringify(value);
  }

  override get sql(): string {
    return 'JSON';
  }
}

/**
 * A binary storage JSON column. Only available in Postgres.
 *
 * __Fallback policy:__
 * If the dialect does not support this type natively, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.JSONB
 * ```
 *
 * @category DataTypes
 */
export class JSONB extends JSON {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'JSONB';

  override get sql(): string {
    return 'JSONB';
  }
}

export type AcceptedBlob = Buffer | string;

export type BlobLength = 'tiny' | 'medium' | 'long';

export interface BlobOptions {
  // TODO: must also allow BLOB(255), BLOB(16M) in db2/ibmi
  length?: BlobLength | undefined;
}

/**
 * Binary storage. BLOB is the "TEXT" of binary data: it allows data of arbitrary size.
 *
 * __Fallback policy:__
 * If this type is not supported, an error will be raised.
 *
 * @example
 * ```ts
 * const User = sequelize.define('User', {
 *   profilePicture: {
 *     type: DataTypes.BLOB,
 *   },
 * });
 * ```
 *
 * @category DataTypes
 */
// TODO: add FIXED_BINARY & VAR_BINARY data types. They are not the same as CHAR BINARY / VARCHAR BINARY.
export class BLOB extends AbstractDataType<AcceptedBlob> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'BLOB';
  readonly options: BlobOptions;

  /**
   * @param lengthOrOptions could be tiny, medium, long.
   */
  constructor(lengthOrOptions?: BlobLength | BlobOptions) {
    super();

    // TODO: valide input (tiny, medium, long, number, 16M, 2G, etc)

    this.options = {
      length: typeof lengthOrOptions === 'object' ? lengthOrOptions.length : lengthOrOptions,
    };
  }

  override get sql(): string {
    switch (this.options.length) {
      case 'tiny':
        return 'TINYBLOB';
      case 'medium':
        return 'MEDIUMBLOB';
      case 'long':
        return 'LONGBLOB';
      default:
        return 'BLOB';
    }
  }

  override sanitize(value: unknown): unknown {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return makeBufferFromTypedArray(value);
    }

    if (typeof value === 'string') {
      return Buffer.from(value);
    }

    return value;
  }

  getBindParamSql(value: AcceptedBlob, options: BindParamOptions) {
    return options.bindParam(value);
  }
}

export interface RangeOptions {
  subtype?: DataTypeClassOrInstance;
}

/**
 * A column storing a unique universal identifier.
 * Use with `UUIDV1` or `UUIDV4` for default values.
 *
 * __Fallback policy:__
 * If this type is not supported, it will be replaced by a string type with a CHECK constraint to enforce a GUID format.
 *
 * @example
 * ```ts
 * const User = sequelize.define('User', {
 *   id: {
 *     type: DataTypes.UUID,
 *   },
 * });
 * ```
 *
 * @category DataTypes
 */
export class UUID extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'UUID';

  override get sql(): string {
    return 'UUID';
  }
}

export interface VirtualOptions {
  returnType?: DataTypeClassOrInstance | undefined;
  attributeDependencies?: string[] | undefined;
}

export interface NormalizedVirtualOptions {
  returnType: DataTypeClassOrInstance | undefined;
  attributeDependencies: string[];
}

/**
 * If an array, each element in the array is a possible value for the ENUM.
 *
 * If a record (plain object, typescript enum),
 * it will use the keys as the list of possible values for the ENUM, in the order specified by the Object.
 * This is designed to be used with TypeScript enums, but it can be used with plain objects as well.
 * Because we don't handle any mapping between the enum keys and values, we require that they be the same.
 */
type EnumValues<Member extends string> = readonly Member[] | Record<Member, Member>;

export interface EnumOptions<Member extends string> {
  values: EnumValues<Member>;
}

export interface NormalizedEnumOptions<Member extends string> {
  values: readonly Member[];
}

export interface ArrayOptions {
  type: DataTypeClassOrInstance;
}

interface NormalizedArrayOptions {
  type: NormalizedDataType;
}

/**
 * An array of `type`. Only available in Postgres.
 *
 * __Fallback policy:__
 * If this type is not supported, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.ARRAY(DataTypes.DECIMAL)
 * ```
 *
 * @category DataTypes
 */
export class ARRAY<T extends AbstractDataType<any>> extends AbstractDataType<Array<AcceptableTypeOf<T>>> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'ARRAY';
  readonly options: NormalizedArrayOptions;

  /**
   * @param typeOrOptions type of array values
   */
  constructor(typeOrOptions: DataType | ArrayOptions) {
    super();

    const rawType = isDataType(typeOrOptions) ? typeOrOptions : typeOrOptions?.type;

    if (!rawType) {
      throw new TypeError('DataTypes.ARRAY is missing type definition for its values.');
    }

    this.options = {
      type: isString(rawType) ? rawType : dataTypeClassOrInstanceToInstance(rawType),
    };
  }

  override get sql(): string {
    return `${attributeTypeToSql(this.options.type)}[]`;
  }

  override parseDatabaseValue(value: unknown[]): unknown {
    if (!Array.isArray(value)) {
      throw new Error(`DataTypes.ARRAY Received a non-array value from database: ${util.inspect(value)}`);
    }

    if (isString(this.options.type)) {
      return value;
    }

    const subType: AbstractDataType<any> = this.options.type;

    return value.map((item) => subType.parseDatabaseValue(item));
  }

  override toBindableValue(value: Array<AcceptableTypeOf<T>>): unknown {
    if (isString(this.options.type)) {
      return value;
    }

    const subType: AbstractDataType<any> = this.options.type;

    return value.map((val) => subType.toBindableValue(val));
  }

  override sanitize(value: unknown): unknown {
    if (!Array.isArray(value)) {
      return value;
    }

    if (isString(this.options.type)) {
      return;
    }

    const subType: AbstractDataType<any> = this.options.type;

    return value.map((item) => subType.sanitize(item));
  }

  static is<T extends AbstractDataType<any>>(obj: unknown, type: new () => T): obj is ARRAY<T> {
    return obj instanceof ARRAY && obj.options.type instanceof type;
  }
}

/**
 * The cidr type holds an IPv4 or IPv6 network specification. Takes 7 or 19 bytes.
 *
 * Only available for Postgres
 *
 * __Fallback policy:__
 * If this type is not supported, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.CIDR
 * ```
 *
 * @category DataTypes
 */
export class CIDR extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'CIDR';

  override get sql(): string {
    return 'CIDR';
  }
}

/**
 * The INET type holds an IPv4 or IPv6 host address, and optionally its subnet. Takes 7 or 19 bytes
 *
 * Only available for Postgres
 *
 * __Fallback policy:__
 * If this type is not supported, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.INET
 * ```
 *
 * @category DataTypes
 */
export class INET extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'INET';

  override get sql(): string {
    return 'INET';
  }
}

/**
 * The MACADDR type stores MAC addresses. Takes 6 bytes
 *
 * Only available for Postgres
 *
 * __Fallback policy:__
 * If this type is not supported, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.MACADDR
 * ```
 *
 * @category DataTypes
 */
export class MACADDR extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'MACADDR';

  override get sql(): string {
    return 'MACADDR';
  }
}

/**
 * The TSVECTOR type stores text search vectors.
 *
 * Only available for Postgres
 *
 * __Fallback policy:__
 * If this type is not supported, an error will be raised.
 *
 * @example
 * ```ts
 * DataTypes.TSVECTOR
 * ```
 *
 * @category DataTypes
 */
export class TSVECTOR extends AbstractDataType<string> {
  /** @hidden */
  static readonly [kDataTypeIdentifier]: string = 'TSVECTOR';

  override get sql(): string {
    return 'TSVECTOR';
  }
}
