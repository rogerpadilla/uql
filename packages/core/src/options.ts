import { UqlOptions } from './type';

let options: UqlOptions;

const defaultOptions: Partial<UqlOptions> = { logger: console.log };

export function setOptions(opts: UqlOptions) {
  options = { ...defaultOptions, ...opts };
}

export function getOptions() {
  if (!options) {
    return { ...defaultOptions };
  }
  return { ...options };
}

export function getLogger() {
  return options?.logger ?? defaultOptions.logger;
}
