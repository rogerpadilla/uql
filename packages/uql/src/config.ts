import { UqlOptions } from 'uql/type';
import { resetContainer } from './container';

let options: UqlOptions;

export function initUql(conf: UqlOptions) {
  resetContainer();
  options = { logger: console, ...conf };
  options.loggingLevel = LOGGING_LEVELS[options.loggingLevel]
    ? LOGGING_LEVELS[options.loggingLevel]
    : LOGGING_LEVELS.info;
  return options;
}

export function getUqlOptions(): UqlOptions {
  if (!options) {
    initUql({});
  }
  return { ...options };
}

export function log(message: any, level = 1) {
  const { logger, loggingLevel } = getUqlOptions();
  if (level >= loggingLevel) {
    logger[level](message);
  }
}

export const LOGGING_LEVELS = {
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
} as const;
