export function formatKebabCase(val: string) {
  let resp = val.charAt(0).toLowerCase();
  for (let i = 1; i < val.length; ++i) {
    resp += val[i] === val[i].toUpperCase() ? '-' + val[i].toLowerCase() : val[i];
  }
  return resp;
}

export function formatCamelCase(val: string) {
  const resp = val.charAt(0).toLowerCase() + val.slice(1);
  return resp;
}
