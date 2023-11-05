import type { DataType, DataTypeClass, DataTypeClassOrInstance, DataTypeInstance } from './data-types.js';
import { AbstractDataType } from './data-types.js';

export function isDataType(value: any): value is DataType {
  return isDataTypeClass(value) || value instanceof AbstractDataType;
}

export function isDataTypeClass(value: any): value is DataTypeClass {
  return typeof value === 'function' && value.prototype instanceof AbstractDataType;
}

export function attributeTypeToSql(type: AbstractDataType<any> | string): string {
  if (typeof type === 'string') {
    return type;
  }

  if (type instanceof AbstractDataType) {
    return type.sql;
  }

  throw new Error('attributeTypeToSql received a type that is neither a string or an instance of AbstractDataType');
}

export function dataTypeClassOrInstanceToInstance(Type: DataTypeClassOrInstance): DataTypeInstance {
  return typeof Type === 'function' ? new Type() : Type;
}
