import { RequestCallback, RequestNotification } from '../type';

const subscriptors: RequestCallback[] = [];

export function notify(notification: RequestNotification): void {
  subscriptors.forEach((subscriptor) => subscriptor(notification));
}

export function on(cb: RequestCallback): () => void {
  subscriptors.push(cb);
  const index = subscriptors.length - 1;
  return (): void => {
    subscriptors.splice(index, 1);
  };
}
