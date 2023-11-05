import dayjs from 'dayjs';
import { DateLike } from './types.js';

const formatOptions = Object.freeze<Intl.DateTimeFormatOptions>({
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
});

export const dateOnlyFormatter = new Intl.DateTimeFormat('en-US', {
  ...formatOptions,
});

export const ensureDate = (date: DateLike) => {
  if (date instanceof Date) {
    return date;
  }
  if (date) {
    return new Date(date);
  }
};

export const formatAsDateOnly = (date: DateLike) => {
  date = ensureDate(date);
  return dateOnlyFormatter.format(date);
};

export const isValidDate = (val: string) => {
  return dayjs(val).isValid();
};
