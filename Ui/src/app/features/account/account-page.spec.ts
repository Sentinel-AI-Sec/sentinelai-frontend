import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountApi } from '../../core/api/account-api';
import { Auth, Session } from '../../core/auth/auth';
import { toUiRole } from '../../core/auth/roles';
import { AccountPage } from './account-page';

/** Stands in for the real login page so `router.navigate(['/login'])` has somewhere to land. */
@Component({ template: '' })
class StubLoginPage {}

class FakeAuth {
  readonly dropSession = vi.fn();
  constructor(
    private readonly roleValue: string,
    private readonly tenantIdValue: string,
  ) {}
  role() {
    return this.roleValue;
  }
  /**
   * The console's name for the role. Derived here rather than hard-coded, so a double built
   * with `analyst` shows `dev` exactly as the real service would — this screen renders both,
   * and a stub that answered a fixed string could not tell the two apart.
   */
  uiRole() {
    return toUiRole(this.roleValue);
  }
  tenantId() {
    return this.tenantIdValue;
  }
  /**
   * The screen shows the token's scopes and both expiries, so the double has to carry a
   * session rather than only a role and a tenant — a stub that answers `undefined` here would
   * have the page silently skip the half of itself that explains *why* an action is gated.
   */
  session(): Session | null {
    return {
      accessToken: 'access',
      refreshToken: 'refresh',
      tenantId: this.tenantIdValue,
      role: this.roleValue,
      scopes: ['scan:read', 'report:read'],
      expiresAt: '2026-01-01T00:00:00Z',
      refreshExpiresAt: '2026-02-01T00:00:00Z',
    };
  }
}

describe('AccountPage', () => {
  function render(role: string, deleteAccount?: () => ReturnType<AccountApi['deleteAccount']>) {
    const auth = new FakeAuth(role, 'tenant-1');

    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', component: StubLoginPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: auth },
        { provide: AccountApi, useValue: { deleteAccount } },
      ],
    });

    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    return { fixture, auth };
  }

  it('hides the delete control for a non-admin role', () => {
    const { fixture } = render('analyst');

    expect(fixture.componentInstance.isAdmin).toBe(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('requires the admin role');
  });

  it('refuses to delete until the typed confirmation matches the tenant id exactly', () => {
    const deleteAccount = vi.fn(() => of(undefined));
    const { fixture } = render('admin', deleteAccount);

    fixture.componentInstance.confirmation.set('not-the-tenant-id');
    fixture.componentInstance.deleteAccount();
    expect(deleteAccount).not.toHaveBeenCalled();

    fixture.componentInstance.confirmation.set('tenant-1');
    fixture.componentInstance.deleteAccount();
    expect(deleteAccount).toHaveBeenCalled();
  });

  it('trims the confirmation before comparing it', () => {
    const fixture = render('admin').fixture;

    fixture.componentInstance.confirmation.set('  tenant-1  ');

    expect(fixture.componentInstance.confirmationMatches()).toBe(true);
  });

  it('drops the local session and leaves for /login on success — there is nothing left to sign out of', () => {
    const { fixture, auth } = render('admin', () => of(undefined));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    fixture.componentInstance.confirmation.set('tenant-1');
    fixture.componentInstance.deleteAccount();

    expect(auth.dropSession).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('reports a 403 without dropping the session, so the account still exists to retry against', () => {
    const { fixture, auth } = render('admin', () =>
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );

    fixture.componentInstance.confirmation.set('tenant-1');
    fixture.componentInstance.deleteAccount();

    expect(fixture.componentInstance.error()).toContain('admin role');
    expect(fixture.componentInstance.deleting()).toBe(false);
    expect(auth.dropSession).not.toHaveBeenCalled();
  });
});
