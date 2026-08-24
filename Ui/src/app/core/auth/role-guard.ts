import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Auth } from './auth';
import { Area } from './roles';

/**
 * Keeps a role off the screens its role does not include.
 *
 * Like {@link authGuard}, a usability guard rather than a security control: the API gates the
 * same actions on the same token and answers 403 whatever the browser renders. This exists so
 * the address bar cannot reach a screen the navigation deliberately does not offer — a `user`
 * typing `/setup` should land somewhere sensible instead of on a page whose every button
 * fails.
 *
 * Denied navigation goes to the dashboard, which is the one area every role holds, rather than
 * to `/login`: the visitor is signed in and their session is fine, so bouncing them to a login
 * form would say the opposite of what happened.
 *
 * Composed with `authGuard`, never in place of it — signed out, {@link Auth.uiRole} resolves to
 * `user`, which reaches `/scans` and `/billing`. Order matters in `canActivate`: `authGuard`
 * runs first so the un-signed-in visitor gets the login redirect with their `returnUrl`, not a
 * silent bounce to a dashboard they also cannot see.
 */
export function areaGuard(area: Area): CanActivateFn {
  return () => {
    const auth = inject(Auth);
    const router = inject(Router);

    return auth.canSee(area) || router.createUrlTree(['/']);
  };
}
