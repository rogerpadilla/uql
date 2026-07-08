import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { withContext } from '../context/context.js';
import type { UqlContext } from '../type/index.js';

/**
 * Runs each request inside `withContext`, so parameterized/`security` filters (multi-tenancy, RLS)
 * are scoped automatically for every query in the request - including relations, cascades, and
 * `@Transactional` services. Wired for you by {@link UqlModule.forRoot} when you pass `getContext`.
 */
@Injectable()
export class UqlContextInterceptor<Req = unknown> implements NestInterceptor {
  constructor(private readonly getContext: (request: Req) => UqlContext | undefined) {}

  intercept(execContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const context = this.getContext(execContext.switchToHttp().getRequest()) ?? {};
    // Subscribe inside the context so the handler's async chain (and its queries) inherit it.
    return new Observable((subscriber) => withContext(context, () => next.handle().subscribe(subscriber)));
  }
}
