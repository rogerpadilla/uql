import type { RequestCallback, RequestNotification } from '../type/index.js';

const subscriptors: RequestCallback[] = [];

export function notify(notification: RequestNotification): void {
  for (const subscriptor of subscriptors) {
    subscriptor(notification);
  }
}

export function on(cb: RequestCallback): () => void {
  subscriptors.push(cb);
  const index = subscriptors.length - 1;
  return (): void => {
    subscriptors.splice(index, 1);
  };
}
