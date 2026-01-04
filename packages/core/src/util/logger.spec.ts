import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultLogger, LoggerWrapper } from './logger.js';

// Helper to strip ANSI escape codes
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are necessary for testing color output
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

describe('DefaultLogger', () => {
  let spyLog: any;
  let spyWarn: any;
  let spyInfo: any;
  let spyError: any;

  beforeEach(() => {
    spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spyInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log query with duration and values', () => {
    const logger = new DefaultLogger();
    logger.logQuery('SELECT * FROM users', [1], 50);
    const call = stripAnsi(spyLog.mock.calls[0][0]);
    expect(call).toContain('query: SELECT * FROM users -- [1]');
    expect(call).toContain('[50ms]');
  });

  it('should log slow query', () => {
    const logger = new DefaultLogger();
    logger.logSlowQuery('SELECT * FROM large_table', [], 200);
    const call = stripAnsi(spyWarn.mock.calls[0][0]);
    expect(call).toContain('slow query: SELECT * FROM large_table');
    expect(call).toContain('[200ms]');
  });

  it('should log warn', () => {
    const logger = new DefaultLogger();
    logger.logWarn('Some warning');
    const call = stripAnsi(spyWarn.mock.calls[0][0]);
    expect(call).toContain('warn: Some warning');
  });

  it('should log error', () => {
    const logger = new DefaultLogger();
    const error = new Error('Some error');
    logger.logError('Error message', error);
    const call = stripAnsi(spyError.mock.calls[0][0]);
    expect(call).toContain('error: Error message');
    expect(spyError.mock.calls[0][1]).toBe(error);
  });

  it('should log info', () => {
    const logger = new DefaultLogger();
    logger.logInfo('Some info');
    const call = stripAnsi(spyInfo.mock.calls[0][0]);
    expect(call).toContain('info: Some info');
  });

  it('should log schema', () => {
    const logger = new DefaultLogger();
    logger.logSchema('CREATE TABLE');
    const call = stripAnsi(spyLog.mock.calls[0][0]);
    expect(call).toContain('schema: CREATE TABLE');
  });

  it('should log migration', () => {
    const logger = new DefaultLogger();
    logger.logMigration('Running migration');
    const call = stripAnsi(spyLog.mock.calls[0][0]);
    expect(call).toContain('migration: Running migration');
  });
});

describe('LoggerWrapper', () => {
  let spyLog: any;
  let spyWarn: any;
  let spyInfo: any;
  let spyError: any;

  beforeEach(() => {
    spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spyInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not log if options is false', () => {
    const wrapper = new LoggerWrapper(false);
    wrapper.logQuery('SELECT 1');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('should log all levels if options is true', () => {
    const wrapper = new LoggerWrapper(true);
    wrapper.logQuery('SELECT 1');
    wrapper.logInfo('info');
    wrapper.logWarn('warn');
    wrapper.logError('error');
    wrapper.logSchema('schema');
    wrapper.logMigration('migration');

    expect(spyLog).toHaveBeenCalledTimes(3); // query, schema, migration
    expect(spyInfo).toHaveBeenCalledTimes(1);
    expect(spyWarn).toHaveBeenCalledTimes(1);
    expect(spyError).toHaveBeenCalledTimes(1);
  });

  it('should log only specific levels', () => {
    const wrapper = new LoggerWrapper(['warn']);
    wrapper.logQuery('SELECT 1');
    wrapper.logWarn('warn');

    expect(spyLog).not.toHaveBeenCalled();
    expect(spyWarn).toHaveBeenCalledTimes(1);
  });

  it('should handle slow query threshold', () => {
    const wrapper = new LoggerWrapper(true, 100);

    wrapper.logQuery('SELECT 1', [], 50);
    expect(spyWarn).not.toHaveBeenCalled();
    expect(spyLog).toHaveBeenCalledTimes(1);

    wrapper.logQuery('SELECT 1', [], 150);
    const call = stripAnsi(spyWarn.mock.calls[0][0]);
    expect(call).toContain('slow query');
  });

  it('should handle slow query threshold even if logger is false', () => {
    const wrapper = new LoggerWrapper(false, 100);

    wrapper.logQuery('SELECT 1', [], 50);
    expect(spyLog).not.toHaveBeenCalled();
    expect(spyWarn).not.toHaveBeenCalled();

    wrapper.logQuery('SELECT 1', [], 150);
    expect(spyWarn).toHaveBeenCalledTimes(1);
    const call = stripAnsi(spyWarn.mock.calls[0][0]);
    expect(call).toContain('slow query');
  });

  it('should use custom function if provided', () => {
    const customFunc = vi.fn();
    const wrapper = new LoggerWrapper(customFunc);
    wrapper.logQuery('SELECT 1', [1], 10);
    expect(customFunc).toHaveBeenCalledWith('SELECT 1', [1], 10);
  });

  it('should use custom logger object if provided', () => {
    const customLogger = {
      logQuery: vi.fn(),
      logError: vi.fn(),
    };
    const wrapper = new LoggerWrapper(customLogger);
    wrapper.logQuery('SELECT 1', [], 5);
    wrapper.logError('fail');

    expect(customLogger.logQuery).toHaveBeenCalled();
    expect(customLogger.logError).toHaveBeenCalled();
  });
});
