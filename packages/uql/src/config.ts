import { UqlOptions } from 'uql/type';
import { resetContainer } from './container';

let options: UqlOptions;

export function setUqlOptions(conf: UqlOptions) {
  resetContainer();
  options = { logger: console, ...conf };
  options.loggingLevel = LOGGING_LEVELS[options.loggingLevel]
    ? LOGGING_LEVELS[options.loggingLevel]
    : LOGGING_LEVELS.info;
  return options;
}

export function getUqlOptions(): UqlOptions {
  if (!options) {
    setUqlOptions({});
  }
  return { ...options };
}

export function log(message: any, level: keyof typeof LOGGING_LEVELS = 'debug') {
  const { logger, loggingLevel } = getUqlOptions();
  const val = LOGGING_LEVELS[level];
  if (val >= loggingLevel) {
    logger[level](message);
  }
}

const LOGGING_LEVELS = {
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
} as const;
