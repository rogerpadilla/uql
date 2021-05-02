export function kebabCase(val: string): string {
  let resp = val.charAt(0).toLowerCase();
  for (let i = 1; i < val.length; ++i) {
    resp += val[i] === val[i].toUpperCase() ? '-' + val[i].toLowerCase() : val[i];
  }
  return resp;
}

export function startCase(text: string): string {
  return text
    .split(/-/)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ');
}
