import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { tap } from 'rxjs';

/**
 * Logs every HTTP call this app makes, to the browser console — method, URL, and how it
 * resolved (status + latency, or the error).
 *
 * Registered last in `app.config.ts`'s interceptor list, deliberately: interceptors run
 * outermost-first on the way out and innermost-first on the way back, so the last one in the
 * array sits closest to the actual network call. That matters here specifically because of
 * `authInterceptor`'s refresh-on-401 retry — that retry calls `next()` directly (it does not
 * re-enter the chain from the top), so a logger placed *before* `authInterceptor` would never
 * see the retried request, only the original 401. Placed after it, this sees every request that
 * actually reaches the wire: the original call, the token refresh itself (a separate top-level
 * request that re-enters the full chain), and the retry.
 *
 * Deliberately logs only method/URL/status/timing, never headers or bodies — request bodies
 * include login/register passwords and every response carries a bearer token or report data.
 * "Every request was made and how it resolved" is the useful signal for wiring/debugging; the
 * payloads are not something that belongs in a browser console.
 */
export const loggingInterceptor: HttpInterceptorFn = (request, next) => {
  const startedAt = performance.now();
  const label = `${request.method} ${request.urlWithParams}`;

  console.debug(`[api] → ${label}`);

  return next(request).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          console.debug(`[api] ← ${label} ${event.status} (${elapsed(startedAt)}ms)`);
        }
      },
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : 'network error';
        console.error(`[api] ✗ ${label} ${status} (${elapsed(startedAt)}ms)`);
      },
    }),
  );
};

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
