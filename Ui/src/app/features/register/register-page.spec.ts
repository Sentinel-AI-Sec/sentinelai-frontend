import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Auth, Session } from '../../core/auth/auth';
import { RegisterPage } from './register-page';

const session: Session = {
  accessToken: 'tok',
  refreshToken: 'refresh',
  tenantId: 'tenant-1',
  role: 'admin',
  scopes: ['scan:read', 'scan:write', 'report:read'],
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('RegisterPage', () => {
  function render(register: (email: string, password: string, tenantName: string) => Observable<Session>) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: { register } },
      ],
    });

    const fixture = TestBed.createComponent(RegisterPage);
    fixture.detectChanges();
    return fixture;
  }

  it('registers with exactly what was typed, and navigates in on success', () => {
    const register = vi.fn(() => of(session));
    const fixture = render(register);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl');

    fixture.componentInstance.tenantName.set('Acme');
    fixture.componentInstance.email.set('a@example.com');
    fixture.componentInstance.password.set('pw');
    fixture.componentInstance.submit();

    expect(register).toHaveBeenCalledWith('a@example.com', 'pw', 'Acme');
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  it('does not call register a second time while the first call is still in flight', () => {
    const pending = new Subject<Session>();
    const register = vi.fn(() => pending.asObservable());
    const fixture = render(register);

    fixture.componentInstance.email.set('a@example.com');
    fixture.componentInstance.password.set('pw');
    fixture.componentInstance.tenantName.set('Acme');

    fixture.componentInstance.submit();
    fixture.componentInstance.submit();

    expect(register).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.submitting()).toBe(true);
  });

  it('reports an unreachable backend distinctly from a rejected registration', () => {
    const fixture = render(() =>
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );

    fixture.componentInstance.submit();

    expect(fixture.componentInstance.error()).toContain('Could not reach the backend');
    expect(fixture.componentInstance.submitting()).toBe(false);
  });

  it('names a 409 as an already-registered email', () => {
    const fixture = render(() =>
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );

    fixture.componentInstance.submit();

    expect(fixture.componentInstance.error()).toContain('already registered');
  });
});
