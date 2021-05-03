export function kebabCase(val: string): string {
  let resp = val.charAt(0).toLowerCase();
  for (let i = 1; i < val.length; ++i) {
    resp += val[i] === val[i].toUpperCase() ? '-' + val[i].toLowerCase() : val[i];
  }
  return resp;
}

export function startUpperCase(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

export function startLowerCase(text: string): string {
  return text[0].toLowerCase() + text.slice(1);
}
