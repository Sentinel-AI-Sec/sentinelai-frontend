import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loggingInterceptor } from './logging-interceptor';

describe('loggingInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([loggingInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    vi.restoreAllMocks();
  });

  it('logs the method and URL of a successful call, with no body in the log', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    http.get('/v1/scans/s1/chains').subscribe();
    backend.expectOne('/v1/scans/s1/chains').flush({ secret: 'should-not-appear-in-logs' });

    const lines = debugSpy.mock.calls.map((args) => String(args[0]));
    expect(lines.some((l) => l.includes('→ GET /v1/scans/s1/chains'))).toBe(true);
    expect(lines.some((l) => l.includes('← GET /v1/scans/s1/chains 200'))).toBe(true);
    expect(lines.join('\n')).not.toContain('should-not-appear-in-logs');
  });

  it('logs a failed call at error level with its status, not as a silent success', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    http.get('/v1/scans/missing').subscribe({ error: () => {} });
    backend.expectOne('/v1/scans/missing').flush('not found', { status: 404, statusText: 'Not Found' });

    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes('404'))).toBe(true);
    // No "←" success line for this request.
    expect(debugSpy.mock.calls.some((args) => String(args[0]).startsWith('[api] ←'))).toBe(false);
  });

  it('never logs the request body — auth calls carry a plaintext password', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    http.post('/v1/auth/login', { email: 'a@example.com', password: 'super-secret' }).subscribe();
    backend.expectOne('/v1/auth/login').flush({});

    expect(debugSpy.mock.calls.flat().join('\n')).not.toContain('super-secret');
  });
});
