import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Auth } from './auth';

/**
 * Keeps unauthenticated visitors off the report screens.
 *
 * This is a usability guard, not a security control: the data it protects lives behind the
 * API's own authentication and tenant filter, and a determined visitor with no token simply
 * gets 401s. The guard exists so that case shows a login page instead of an empty report.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  // Remember where they were headed, so signing in lands them there rather than at the top.
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
