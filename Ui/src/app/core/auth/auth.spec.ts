import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../config/environment';
import { Auth } from './auth';
import { authInterceptor } from './auth-interceptor';

/** Stands in for the real login page so `router.navigate(['/login'])` has somewhere to land. */
@Component({ template: '' })
class StubLoginPage {}

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
        // A real 'login' route, not []: the refresh-failure tests below trigger
        // `router.navigate(['/login'])`, which throws NG04002 against an empty route table.
        provideRouter([{ path: 'login', component: StubLoginPage }]),
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

  it('discards a stored session whose refresh token has already expired', () => {
    // Restoring it would send it, get a 401 on every request and bounce to login anyway — but
    // only after a failed request, which reads as a broken screen rather than a finished session.
    localStorage.setItem(
      'sentinelai.session',
      JSON.stringify({
        accessToken: 'stale',
        refreshToken: 'stale',
        tenantId: 't',
        role: 'analyst',
        scopes: [],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        refreshExpiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    expect(TestBed.inject(Auth).isAuthenticated()).toBe(false);
  });

  it('keeps a stored session whose access token expired but whose refresh token has not', () => {
    // This is the case refresh() exists for: an hour-old tab should not need a fresh login just
    // because the short-lived access token lapsed while a much longer-lived refresh token is
    // still good.
    localStorage.setItem(
      'sentinelai.session',
      JSON.stringify({
        accessToken: 'stale',
        refreshToken: 'still-good',
        tenantId: 't',
        role: 'analyst',
        scopes: [],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    expect(TestBed.inject(Auth).isAuthenticated()).toBe(true);
  });

  it('on a 401, refreshes the token once and replays the original request', () => {
    signIn();
    TestBed.inject(HttpClient).get('/v1/scans/s1/chains').subscribe();

    http.expectOne('/v1/scans/s1/chains').flush('unauthorized', { status: 401, statusText: 'Unauthorized' });

    const refreshRequest = http.expectOne('/v1/auth/refresh');
    expect(refreshRequest.request.body).toEqual({ refreshToken: 'refresh-abc' });
    refreshRequest.flush({
      statusCode: 200,
      isSuccess: true,
      message: '',
      data: {
        accessToken: 'jwt-rotated',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshToken: 'refresh-rotated',
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        tenantId: 'tenant-1',
        role: 'analyst',
        scopes: ['scan:read'],
      },
    });

    const replay = http.expectOne('/v1/scans/s1/chains');
    expect(replay.request.headers.get('Authorization')).toBe('Bearer jwt-rotated');
    replay.flush({ items: [], next_cursor: null, limit: 50 });

    expect(TestBed.inject(Auth).session()?.accessToken).toBe('jwt-rotated');
  });

  it('drops the session and stops retrying when the refresh token itself is rejected', () => {
    signIn();
    TestBed.inject(HttpClient).get('/v1/scans/s1/chains').subscribe({ error: () => {} });

    http.expectOne('/v1/scans/s1/chains').flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    http
      .expectOne('/v1/auth/refresh')
      .flush('unauthorized', { status: 401, statusText: 'Unauthorized' });

    http.verify();
    expect(TestBed.inject(Auth).isAuthenticated()).toBe(false);
  });

  it('logout revokes the refresh token server-side, then clears the session', () => {
    signIn();
    const auth = TestBed.inject(Auth);

    auth.logout().subscribe();

    const request = http.expectOne('/v1/auth/logout');
    expect(request.request.body).toEqual({ refreshToken: 'refresh-abc' });
    request.flush({ statusCode: 200, isSuccess: true, message: '', data: null });

    expect(auth.isAuthenticated()).toBe(false);
  });

  it('logout still clears the local session if the backend call fails', () => {
    signIn();
    const auth = TestBed.inject(Auth);

    auth.logout().subscribe();

    http.expectOne('/v1/auth/logout').flush('boom', { status: 500, statusText: 'Server Error' });

    expect(auth.isAuthenticated()).toBe(false);
  });
});
