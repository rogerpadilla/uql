import { UqlClientOptions } from './type';

let options: UqlClientOptions;

const defaultOptions: Partial<UqlClientOptions> = { baseApiPath: '/api' };

export function setOptions(opts: UqlClientOptions) {
  options = { ...defaultOptions, ...opts };
}

export function getOptions() {
  if (!options) {
    return { ...defaultOptions };
  }
  return { ...options };
}

export function getBasePathApi(): string {
  return options?.baseApiPath ?? defaultOptions.baseApiPath;
}
