import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountApi, MemberDto } from '../../core/api/account-api';
import { Auth, Session } from '../../core/auth/auth';
import { toUiRole } from '../../core/auth/roles';
import { AccountPage } from './account-page';

/** Stands in for the real login page so `router.navigate(['/login'])` has somewhere to land. */
@Component({ template: '' })
class StubLoginPage {}

/** The signed-in admin's own id, so the members table has a row it must refuse to edit. */
const SelfUserId = 'user-self';

function member(overrides: Partial<MemberDto> = {}): MemberDto {
  return {
    userId: 'user-2',
    email: 'colleague@example.com',
    role: 'viewer',
    scopes: ['scan:read', 'report:read'],
    isEmailVerified: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

class FakeAuth {
  readonly dropSession = vi.fn();
  constructor(
    private readonly roleValue: string,
    private readonly tenantIdValue: string,
  ) {}
  role() {
    return this.roleValue;
  }
  userId() {
    return SelfUserId;
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
      userId: SelfUserId,
      role: this.roleValue,
      scopes: ['scan:read', 'report:read'],
      expiresAt: '2026-01-01T00:00:00Z',
      refreshExpiresAt: '2026-02-01T00:00:00Z',
    };
  }
}

describe('AccountPage', () => {
  interface ApiStub {
    deleteAccount?: () => ReturnType<AccountApi['deleteAccount']>;
    listMembers?: () => ReturnType<AccountApi['listMembers']>;
    changeMemberRole?: (
      userId: string,
      role: MemberDto['role'],
    ) => ReturnType<AccountApi['changeMemberRole']>;
    addMember?: (
      email: string,
      role: MemberDto['role'],
    ) => ReturnType<AccountApi['addMember']>;
  }

  function render(role: string, api: ApiStub = {}) {
    const auth = new FakeAuth(role, 'tenant-1');

    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', component: StubLoginPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: auth },
        // The members list is fetched on init for an admin, so every admin render needs it —
        // defaulted to empty rather than left undefined so a test about deletion does not have
        // to know that the screen also loads members.
        { provide: AccountApi, useValue: { listMembers: () => of([]), ...api } },
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
    const { fixture } = render('admin', { deleteAccount });

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
    const { fixture, auth } = render('admin', { deleteAccount: () => of(undefined) });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    fixture.componentInstance.confirmation.set('tenant-1');
    fixture.componentInstance.deleteAccount();

    expect(auth.dropSession).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('reports a 403 without dropping the session, so the account still exists to retry against', () => {
    const { fixture, auth } = render('admin', {
      deleteAccount: () => throwError(() => new HttpErrorResponse({ status: 403 })),
    });

    fixture.componentInstance.confirmation.set('tenant-1');
    fixture.componentInstance.deleteAccount();

    expect(fixture.componentInstance.error()).toContain('admin role');
    expect(fixture.componentInstance.deleting()).toBe(false);
    expect(auth.dropSession).not.toHaveBeenCalled();
  });

  // ---- Members ------------------------------------------------------------------------------

  it('does not ask for the members of the organisation unless the caller is an admin', () => {
    // The endpoint is admin-only. Calling it as a viewer would spend a round trip to be told a
    // 403 the role already predicts, and would put an error on a screen that is working.
    const listMembers = vi.fn(() => of([member()]));
    const { fixture } = render('analyst', { listMembers });

    expect(listMembers).not.toHaveBeenCalled();
    expect(fixture.componentInstance.members()).toEqual([]);
  });

  it('loads the members for an admin', () => {
    const { fixture } = render('admin', { listMembers: () => of([member()]) });

    expect(fixture.componentInstance.members()).toHaveLength(1);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('colleague@example.com');
  });

  it('names the roles as the API stores them, not as the console renders them elsewhere', () => {
    // `analyst` everywhere else in the console is `dev`. Here the value being chosen is the one
    // that lands in the member's token, so translating it would offer a role the admin could
    // never verify against a decoded JWT.
    const { fixture } = render('admin', {
      listMembers: () => of([member({ role: 'analyst' })]),
    });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('analyst');
    expect(text).not.toContain('dev');
  });

  it('marks the signed-in admin’s own row as theirs and offers no selector for it', () => {
    const { fixture } = render('admin', {
      listMembers: () => of([member({ userId: SelfUserId, email: 'me@example.com' })]),
    });

    const self = fixture.componentInstance.members()[0];
    expect(fixture.componentInstance.isSelf(self)).toBe(true);

    // One row, and it is the caller's — so the table body must render no role <select> at all.
    // Scoped to tbody rather than the page: the add-member form above it has a role select of
    // its own, which is not what this is about.
    const selects = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody select');
    expect(selects).toHaveLength(0);
  });

  it('assigns a role and replaces the row with what the server returned', () => {
    const changeMemberRole = vi.fn(() => of(member({ role: 'analyst', scopes: ['scan:write'] })));
    const { fixture } = render('admin', {
      listMembers: () => of([member()]),
      changeMemberRole,
    });

    fixture.componentInstance.changeRole(fixture.componentInstance.members()[0], 'analyst');

    expect(changeMemberRole).toHaveBeenCalledWith('user-2', 'analyst');
    // The server's row, not the one the screen guessed at: the scopes come back with it.
    expect(fixture.componentInstance.members()[0].role).toBe('analyst');
    expect(fixture.componentInstance.members()[0].scopes).toEqual(['scan:write']);
    expect(fixture.componentInstance.savingMemberId()).toBeNull();
  });

  it('does not call the API when the selected role is the one already held', () => {
    const changeMemberRole = vi.fn(() => of(member()));
    const { fixture } = render('admin', {
      listMembers: () => of([member({ role: 'viewer' })]),
      changeMemberRole,
    });

    fixture.componentInstance.changeRole(fixture.componentInstance.members()[0], 'viewer');

    expect(changeMemberRole).not.toHaveBeenCalled();
  });

  it('explains a 400 as the self-change rule rather than as a failure', () => {
    // A session stored before `userId` existed cannot identify its own row, so the API's refusal
    // is the backstop. It has to read as a rule, not as a bug.
    const { fixture } = render('admin', {
      listMembers: () => of([member()]),
      changeMemberRole: () => throwError(() => new HttpErrorResponse({ status: 400 })),
    });

    fixture.componentInstance.changeRole(fixture.componentInstance.members()[0], 'admin');

    expect(fixture.componentInstance.memberError()).toContain('your own role');
    expect(fixture.componentInstance.savingMemberId()).toBeNull();
    // The row is left showing what the server still holds, not the rejected choice.
    expect(fixture.componentInstance.members()[0].role).toBe('viewer');
  });

  // ---- Adding a member ------------------------------------------------------------------------

  it('keeps the add button disabled until the address looks like an email', () => {
    const { fixture } = render('admin');
    const page = fixture.componentInstance;

    page.newEmail.set('not-an-email');
    expect(page.canAdd()).toBe(false);

    page.newEmail.set('colleague@example.com');
    expect(page.canAdd()).toBe(true);
  });

  it('adds a member and appends them to the table', () => {
    const added = member({ userId: 'user-9', email: 'new@example.com', role: 'analyst' });
    const addMember = vi.fn(() =>
      of({
        member: added,
        previousTenantPurged: false,
        previousTenantRowsDeleted: 0,
        sessionsRevoked: 1,
      }),
    );
    const { fixture } = render('admin', { listMembers: () => of([member()]), addMember });
    const page = fixture.componentInstance;

    page.newEmail.set('  new@example.com  ');
    page.newRole.set('analyst');
    page.addMember();

    // Trimmed before it goes out — a pasted address usually carries whitespace.
    expect(addMember).toHaveBeenCalledWith('new@example.com', 'analyst');
    expect(page.members()).toHaveLength(2);
    expect(page.newEmail()).toBe('');
    expect(page.adding()).toBe(false);
  });

  it('says plainly that an unregistered address cannot be added', () => {
    // The 404 is the endpoint working: it moves existing accounts and cannot create one. If this
    // reads as "not found" people retry the same address forever.
    const { fixture } = render('admin', {
      addMember: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });
    const page = fixture.componentInstance;

    page.newEmail.set('nobody@example.com');
    page.addMember();

    expect(page.addError()).toContain('need to sign up first');
    expect(page.members()).toHaveLength(0);
  });

  it('passes the server’s own wording through for a 409', () => {
    // Already-a-member and last-admin-elsewhere are both 409 and need different explanations;
    // the server distinguishes them and the screen should not flatten that back down.
    const { fixture } = render('admin', {
      addMember: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'is the last admin of their current organisation' },
            }),
        ),
    });
    const page = fixture.componentInstance;

    page.newEmail.set('boss@example.com');
    page.addMember();

    expect(page.addError()).toContain('last admin');
  });

  it('reports when the move destroyed the person’s previous organisation', () => {
    // One click can delete an entire other tenant. An admin who is not told has no way to find out.
    const { fixture } = render('admin', {
      addMember: () =>
        of({
          member: member({ email: 'solo@example.com' }),
          previousTenantPurged: true,
          previousTenantRowsDeleted: 42,
          sessionsRevoked: 0,
        }),
    });
    const page = fixture.componentInstance;

    page.newEmail.set('solo@example.com');
    page.addMember();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('permanently deleted');
    expect(text).toContain('42');
  });

  it('does not offer the add form to a non-admin', () => {
    const { fixture } = render('analyst');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Add someone by email');
  });

  it('surfaces a failed members load without blanking the rest of the screen', () => {
    const { fixture } = render('admin', {
      listMembers: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });

    expect(fixture.componentInstance.membersError()).toContain('Could not load');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Danger zone');
  });
});
