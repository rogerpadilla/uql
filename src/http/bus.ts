import { RequestErrorResponse, RequestOptions } from './type';

const subscriptors: BusCallback[] = [];

export function notify(msg: BusMessage): void {
  subscriptors.forEach((subscriptor) => subscriptor(msg));
}

export function on(cb: BusCallback): () => void {
  subscriptors.push(cb);
  const index = subscriptors.length - 1;
  return (): void => {
    subscriptors.splice(index, 1);
  };
}

export type BusMessage = BusTask | BusNotification;

export type BusTask = {
  readonly type: 'task';
  readonly phase: 'start' | 'success' | 'error' | 'complete';
  readonly opts?: RequestOptions;
} & Partial<RequestErrorResponse>;

export type BusCallback = (msg: BusMessage) => void;

export type BusNotification = {
  readonly type: 'notification';
  readonly message: string;
  readonly severity?: 'success' | 'info' | 'warning' | 'error';
};
