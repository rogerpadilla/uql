import type { RequestCallback, RequestNotification } from '../type/index.js';

const subscriptors = new Set<RequestCallback>();

export function notify(notification: RequestNotification): void {
  for (const subscriptor of subscriptors) {
    subscriptor(notification);
  }
}

export function on(cb: RequestCallback): () => void {
  subscriptors.add(cb);
  return (): void => {
    subscriptors.delete(cb);
  };
}
