import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../config/environment';
import { Auth } from './auth';
import { authInterceptor } from './auth-interceptor';

/**
 * The tenant-isolation half of SEC-42: the screen must send the token and show only the
 * signed-in user's data.
 *
 * These run against the real HTTP path, so they force demo mode off — otherwise the service
 * would short-circuit and the interceptor would never be exercised, which is precisely the
 * thing worth testing.
 */
describe('Auth and the interceptor', () => {
  let http: HttpTestingController;
  const wasDemo = environment.useDemoData;

  beforeEach(() => {
    environment.useDemoData = false;
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        // withInterceptors, or the interceptor never runs and every assertion about the
        // Authorization header passes for the wrong reason.
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useDemoData = wasDemo;
  });

  /** Puts a real session in place so the interceptor has a token to attach. */
  function signIn(): void {
    TestBed.inject(Auth).login('a@example.com', 'pw').subscribe();

    http.expectOne('/v1/auth/login').flush({
      statusCode: 200,
      isSuccess: true,
      message: '',
      data: {
        accessToken: 'jwt-abc',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshToken: 'refresh-abc',
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        tenantId: 'tenant-1',
        role: 'analyst',
        scopes: ['scan:read'],
      },
    });
  }

  it('unwraps the Response envelope the auth endpoints return', () => {
    // Auth returns { statusCode, isSuccess, data, message } while the read endpoints return
    // the payload bare. Reading the wrong one leaves an undefined token that fails much later.
    const auth = TestBed.inject(Auth);

    auth.login('a@example.com', 'pw').subscribe();

    const request = http.expectOne('/v1/auth/login');
    expect(request.request.body).toEqual({ email: 'a@example.com', password: 'pw' });

    request.flush({
      statusCode: 200,
      isSuccess: true,
      message: '',
      data: {
        accessToken: 'jwt-abc',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshToken: 'refresh-abc',
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        tenantId: 'tenant-1',
        role: 'analyst',
        scopes: ['scan:read'],
      },
    });

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.tenantId()).toBe('tenant-1');
    expect(auth.session()?.accessToken).toBe('jwt-abc');
  });

  it('attaches the bearer token to our own API', () => {
    signIn();
    TestBed.inject(HttpClient).get('/v1/scans/s1/chains').subscribe();

    const request = http.expectOne('/v1/scans/s1/chains');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-abc');
    request.flush({ items: [], next_cursor: null, limit: 50 });
  });

  it('never sends the token to a third party whose path happens to contain /v1/', () => {
    // The whole reason this is matched by origin rather than substring. An earlier version used
    // `url.includes('/v1/')`, which would have handed the customer's credential to this URL.
    signIn();
    TestBed.inject(HttpClient).get('https://someone-else.example.com/v1/collect').subscribe();

    const request = http.expectOne('https://someone-else.example.com/v1/collect');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('does not send the token to a non-API path on our own origin', () => {
    signIn();
    TestBed.inject(HttpClient).get('/assets/config.json').subscribe();

    const request = http.expectOne('/assets/config.json');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('discards a stored session whose token has already expired', () => {
    // Restoring it would send it, get a 401 and bounce to login anyway — but only after a
    // failed request, which reads as a broken screen rather than a finished session.
    localStorage.setItem(
      'sentinelai.session',
      JSON.stringify({
        accessToken: 'stale',
        refreshToken: 'stale',
        tenantId: 't',
        role: 'analyst',
        scopes: [],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    expect(TestBed.inject(Auth).isAuthenticated()).toBe(false);
  });
});
