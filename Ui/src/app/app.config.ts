import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { authInterceptor } from './core/auth/auth-interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    // withComponentInputBinding lets a routed component take :id as a signal input, so the
    // report page never touches ActivatedRoute to read its own identity.
    provideRouter(routes, withComponentInputBinding()),

    // One interceptor, registered once: it attaches the bearer token and ends the session on
    // a 401. Doing it here rather than per-request is what makes "every call is authenticated"
    // true by construction.
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
