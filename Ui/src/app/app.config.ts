import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { authInterceptor } from './core/auth/auth-interceptor';
import { loggingInterceptor } from './core/http/logging-interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    // withComponentInputBinding lets a routed component take :id as a signal input, so the
    // report page never touches ActivatedRoute to read its own identity.
    provideRouter(routes, withComponentInputBinding()),

    // Order matters: authInterceptor first (outermost), loggingInterceptor last (innermost,
    // closest to the wire). authInterceptor's refresh-on-401 retry calls its own `next()`
    // directly rather than re-entering the chain from the top, so a logger placed before it
    // would miss the retried request — placed after, it sees every request that actually
    // reaches the network, not just the ones components initiate directly.
    provideHttpClient(withInterceptors([authInterceptor, loggingInterceptor])),
  ],
};
