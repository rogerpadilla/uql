export function kebabCase(val: string): string {
  let resp = val.charAt(0).toLowerCase();
  for (let i = 1; i < val.length; ++i) {
    resp += val[i] === val[i].toUpperCase() ? '-' + val[i].toLowerCase() : val[i];
  }
  return resp;
}

export function upperFirst(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

export function lowerFirst(text: string): string {
  return text[0].toLowerCase() + text.slice(1);
}

export function snakeCase(val: string): string {
  if (val === undefined || val === null) {
    return val;
  }
  if (!val) {
    return '';
  }
  let resp = val.charAt(0).toLowerCase();
  for (let i = 1; i < val.length; ++i) {
    const char = val[i];
    const charLower = char.toLowerCase();
    if (char !== charLower && char === char.toUpperCase()) {
      resp += '_' + charLower;
    } else {
      resp += char;
    }
  }
  return resp;
}

/**
 * Convert a string to PascalCase (UpperCamelCase).
 * @example 'user_profile' -> 'UserProfile'
 * @example 'some-text' -> 'SomeText'
 */
export function pascalCase(str: string): string {
  if (!str) return '';
  return str
    .split(/[_\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Convert a string to camelCase.
 * @example 'user_profile' -> 'userProfile'
 * @example 'SomeText' -> 'someText'
 */
export function camelCase(str: string): string {
  const pascal = pascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Simple singularize function for English words.
 * @example 'users' -> 'user'
 * @example 'categories' -> 'category'
 */
export function singularize(name: string): string {
  if (!name) return '';
  if (name.endsWith('ies')) {
    return name.slice(0, -3) + 'y';
  }
  if (name.endsWith('ses') || name.endsWith('xes') || name.endsWith('zes')) {
    return name.slice(0, -2);
  }
  if (name.endsWith('s') && !name.endsWith('ss')) {
    return name.slice(0, -1);
  }
  return name;
}

/**
 * Simple pluralize function for English words.
 * @example 'user' -> 'users'
 * @example 'category' -> 'categories'
 */
export function pluralize(name: string): string {
  if (!name) return '';
  if (name.endsWith('y') && name.length > 1 && !/[aeiou]/.test(name[name.length - 2])) {
    return name.slice(0, -1) + 'ies';
  }
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('z') || name.endsWith('ch') || name.endsWith('sh')) {
    return name + 'es';
  }
  return name + 's';
}
