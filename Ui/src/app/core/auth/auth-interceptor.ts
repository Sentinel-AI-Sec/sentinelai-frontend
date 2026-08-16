import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { environment } from '../config/environment';
import { Auth } from './auth';

/**
 * Attaches the bearer token to API calls, and treats a 401 as the end of the session.
 *
 * Registered once in `app.config.ts` rather than added per-request. A component that had to
 * remember to attach the token is a component that will eventually forget, and the symptom —
 * one screen quietly 401-ing — looks like a backend fault rather than a missing header.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const session = auth.session();

  const authorized =
    session && isOurApi(request.url)
      ? request.clone({ setHeaders: { Authorization: `Bearer ${session.accessToken}` } })
      : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // The token is gone or expired. Clear it rather than let the screen keep retrying with
        // a credential the backend has already rejected.
        auth.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};

/**
 * Whether a request is going to our own backend, and may therefore carry the bearer token.
 *
 * Matched by **origin and path prefix**, never by substring. The first version of this asked
 * `url.includes('/v1/')`, which is true of `https://someone-else.example.com/v1/collect` — so
 * the day anyone added a third-party call with a `/v1/` in its path, the customer's token would
 * have gone to them, silently and with no error to notice.
 *
 * A relative URL is same-origin by definition, so it only has to start with `/v1/`. An absolute
 * one is compared against the configured backend's origin, and anything that fails to parse is
 * refused rather than given the benefit of the doubt.
 */
function isOurApi(url: string): boolean {
  if (url.startsWith('/')) return url.startsWith('/v1/');

  // Same-origin by default (the dev proxy), so no absolute URL is ours unless one is configured.
  if (!environment.apiBaseUrl) return false;

  try {
    const target = new URL(url, window.location.origin);
    const api = new URL(environment.apiBaseUrl, window.location.origin);
    return target.origin === api.origin && target.pathname.startsWith('/v1/');
  } catch {
    return false;
  }
}
