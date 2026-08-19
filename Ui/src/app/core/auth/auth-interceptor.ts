import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../config/environment';
import { Auth } from './auth';

/** `POST /v1/auth/refresh` itself must never trigger another refresh attempt on its own 401. */
const RefreshPath = /\/v1\/auth\/refresh$/;

/**
 * Attaches the bearer token to API calls; on a 401 tries the refresh token once before treating
 * the session as over.
 *
 * Registered once in `app.config.ts` rather than added per-request. A component that had to
 * remember to attach the token is a component that will eventually forget, and the symptom —
 * one screen quietly 401-ing — looks like a backend fault rather than a missing header.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const session = auth.session();

  const authorized = session && isOurApi(request.url) ? attach(request, session.accessToken) : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      const eligibleForRefresh =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        session &&
        isOurApi(request.url) &&
        !RefreshPath.test(request.url);

      if (!eligibleForRefresh) {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          // No session to refresh, or the request was already the refresh call itself failing.
          auth.dropSession();
          void router.navigate(['/login']);
        }
        return throwError(() => error);
      }

      // The access token has expired mid-session. Trade the refresh token for a new pair and
      // replay the original request once with it, rather than bouncing to login over what is
      // often just an hour-old tab.
      return auth.refresh().pipe(
        switchMap((refreshed) => next(attach(request, refreshed.accessToken))),
        catchError((refreshError: unknown) => {
          // The refresh token is itself invalid or expired — the session really is over.
          auth.dropSession();
          void router.navigate(['/login']);
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};

function attach(request: HttpRequest<unknown>, accessToken: string): HttpRequest<unknown> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } });
}

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
