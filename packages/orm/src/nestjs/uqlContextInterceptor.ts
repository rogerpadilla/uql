import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { from, Observable, switchMap } from 'rxjs';
import { withContext } from '../context/context.js';
import type { UqlContext } from '../type/index.js';

/**
 * Runs each request inside `withContext`, so policies and parameterized filters
 * are scoped automatically for every query in the request - including relations, cascades, and the
 * queries a transaction runs. Wired for you by {@link UqlModule.forRoot} when you pass `contextOf`.
 */
@Injectable()
export class UqlContextInterceptor<Req = unknown> implements NestInterceptor {
  constructor(private readonly contextOf: (request: Req) => UqlContext | undefined | Promise<UqlContext | undefined>) {}

  intercept(execContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(Promise.resolve(this.contextOf(execContext.switchToHttp().getRequest()))).pipe(
      // Subscribe inside the context so the handler's async chain (and its queries) inherit it.
      switchMap(
        (context) =>
          new Observable((subscriber) => withContext(context ?? {}, () => next.handle().subscribe(subscriber))),
      ),
    );
  }
}
