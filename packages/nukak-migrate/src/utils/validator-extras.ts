import { cloneDeep } from 'lodash';
import val from 'validator';
import { isValidDate } from './date.helper.js';

const theVal = cloneDeep(val.default);

export const validator = {
  ...theVal,
  extend(name: string, fn: (...args: any[]) => any) {
    this[name] = fn;
    return this;
  },
  notEmpty(str: string) {
    return !/^\s*$/.test(str);
  },
  // TODO: accept { min, max } object
  len(str: string, min: number, max: number) {
    return this.isLength(str, { min, max });
  },
  isUrl(str: string) {
    return this.isURL(str);
  },
  isIPv6(str: string) {
    return this.isIP(str, 6);
  },
  isIPv4(str: string) {
    return this.isIP(str, 4);
  },
  notIn(str: string, values: any[]) {
    return !this.isIn(str, values);
  },
  regex(str: string, pattern: RegExp, modifiers: string) {
    str = String(str);
    if (Object.prototype.toString.call(pattern).slice(8, -1) !== 'RegExp') {
      pattern = new RegExp(pattern, modifiers);
    }
    return str.match(pattern);
  },
  notRegex(str: string, pattern: RegExp, modifiers: string) {
    return !this.regex(str, pattern, modifiers);
  },
  isDecimal(str: string) {
    return str !== '' && Boolean(/^(?:-?\d+)?(?:\.\d*)?(?:[Ee][+-]?\d+)?$/.test(str));
  },
  min(str: string, val: number) {
    const number = Number.parseFloat(str);
    return Number.isNaN(number) || number >= val;
  },
  max(str: string, val: number) {
    const number = Number.parseFloat(str);
    return Number.isNaN(number) || number <= val;
  },
  not(str: string, pattern: RegExp, modifiers: string) {
    return this.notRegex(str, pattern, modifiers);
  },
  contains(str: string, elem: string) {
    return Boolean(elem) && str.includes(elem);
  },
  notContains(str: string, elem: string) {
    return !this.contains(str, elem);
  },
  is(str: string, pattern: RegExp, modifiers: string) {
    return this.regex(str, pattern, modifiers);
  },
  notNull(val: any) {
    return val !== null && val !== undefined;
  },
  isNull: theVal.isEmpty,
  isDate(val: any) {
    return isValidDate(val);
  },
};
