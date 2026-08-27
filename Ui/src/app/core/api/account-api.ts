import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of } from 'rxjs';

import { environment } from '../config/environment';
import { ResponseEnvelope } from './wire';

/**
 * The backend roles a member can hold (`Roles.cs`).
 *
 * These are the API's names, not the console's — `analyst` here is what `roles.ts` calls `dev`.
 * The members screen speaks the API's vocabulary deliberately: an admin assigning a role is
 * choosing the value that will sit in someone's token and be compared verbatim by
 * `[Authorize(Roles = ...)]`, so showing them a translated name would mean the thing they picked
 * and the thing they can verify never match.
 */
export const MemberRoles = ['admin', 'analyst', 'viewer'] as const;

export type MemberRole = (typeof MemberRoles)[number];

/**
 * One member of the tenant (`MemberResponse.cs`).
 *
 * camelCase, like `ProjectDto`: this DTO carries no `[JsonPropertyName]` attributes, so it
 * serializes with the API's default policy rather than the snake_case used by the SEC-40 read
 * views in `wire.ts`.
 *
 * `role` is the *row's* role, unlike `Auth.role()`, which reads the signed-in token. Straight
 * after a change the two disagree for the member whose role moved — their token still says what
 * it said when it was issued — and that is the backend's design, not a sync bug.
 */
export interface MemberDto {
  userId: string;
  email: string;
  role: MemberRole;
  scopes: string[];
  isEmailVerified: boolean;
  createdAt: string;
}

/**
 * What `POST /v1/account/members` reports back (`AddMemberResponse.cs`).
 *
 * It carries more than the member who arrived because one call can destroy an entire other
 * organisation: an account that was the sole member of its own tenant takes that tenant with it
 * when it leaves, since a tenant with no users can never have a token issued for it again.
 */
export interface AddMemberResult {
  member: MemberDto;
  previousTenantId?: string;

  /** Whether the organisation they left was emptied by the move, and therefore destroyed. */
  previousTenantPurged: boolean;

  /** Rows destroyed with it. Zero when it was not purged. */
  previousTenantRowsDeleted: number;

  /** Sessions ended, forcing them to sign in again under this organisation. */
  sessionsRevoked: number;
}

/**
 * Account-level operations (`AccountController`): who else is in the tenant, what they may do,
 * and the right to be deleted.
 */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /**
   * Every member of the caller's tenant, ordered by email.
   *
   * Admin-only on the backend, unlike `ProjectsApi.list` — a member row names a colleague's
   * email and what they are permitted to do, which is not something a viewer needs in order to
   * read a report. Callers should gate the whole section on `auth.role() === 'admin'` rather
   * than call this and handle the 403.
   */
  listMembers(): Observable<MemberDto[]> {
    if (environment.useDemoData) {
      return of(DemoMembers.map((member) => ({ ...member }))).pipe(delay(250));
    }

    return this.http
      .get<ResponseEnvelope<MemberDto[]>>(`${this.base}/v1/account/members`)
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Brings an existing account into the tenant with the given role.
   *
   * **The address must already be registered** — this never creates an account, so an unknown
   * address is a `404` and the end of the road, not a prompt to sign someone up. There is no
   * password anywhere in the request.
   *
   * An account belongs to one tenant at a time, so this is a move, and the two `409`s both come
   * from that: they are already here, or they are the last admin of an organisation that still
   * has other members. If they were the *only* member of their old organisation, that
   * organisation is destroyed along with everything in it — {@link AddMemberResult} reports
   * whether that happened, and callers should say so rather than swallow it.
   */
  addMember(email: string, role: MemberRole): Observable<AddMemberResult> {
    if (environment.useDemoData) {
      const added: MemberDto = {
        userId: `demo-user-${DemoMembers.length + 1}`,
        email: email.trim().toLowerCase(),
        role,
        scopes: ScopesForRole[role],
        isEmailVerified: true,
        createdAt: new Date().toISOString(),
      };
      DemoMembers.push(added);
      return of({
        member: added,
        previousTenantPurged: true,
        previousTenantRowsDeleted: 0,
        sessionsRevoked: 0,
      }).pipe(delay(250));
    }

    return this.http
      .post<ResponseEnvelope<AddMemberResult>>(`${this.base}/v1/account/members`, { email, role })
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Assigns a role to another member of the tenant.
   *
   * Two refusals are worth handling by hand rather than as a generic failure, because both are
   * the endpoint working correctly: `400` when the target is the caller themselves (an admin
   * cannot change their own role — that is what keeps a tenant from reaching zero admins), and
   * `404` when the id is not a member of this tenant.
   *
   * The change does not take effect for that member until their next token is issued. The
   * backend revokes their live refresh tokens, so their next renewal fails and the sign-in
   * after it reads the new role; an access token already in their browser keeps its old claims
   * until it expires.
   */
  changeMemberRole(userId: string, role: MemberRole): Observable<MemberDto> {
    if (environment.useDemoData) {
      const member = DemoMembers.find((m) => m.userId === userId) ?? DemoMembers[0];
      member.role = role;
      // Kept in step with the role, because the scopes are the whole point of the change: the
      // difference between analyst and viewer is exactly `scan:write`, and a demo that showed
      // the new role beside the old scopes would misrepresent what was granted.
      member.scopes = ScopesForRole[role];
      return of({ ...member }).pipe(delay(250));
    }

    return this.http
      .patch<ResponseEnvelope<MemberDto>>(`${this.base}/v1/account/members/${userId}`, { role })
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Permanently deletes the calling account and everything it owns: projects, scan jobs, stored
   * bundles, findings, the resource graph, chains and reports. Admin role only, and there is no
   * id parameter — an account can only delete itself.
   *
   * **This cannot be undone.** The caller is responsible for confirming with the user before
   * calling this; there is no server-side grace period to recover from an accidental call.
   */
  deleteAccount(): Observable<void> {
    if (environment.useDemoData) {
      // Nothing to delete against a backend that was never called. The caller still follows up
      // with Auth.logout() either way, so the flow (confirm, delete, sign out) stays intact.
      return of(undefined).pipe(delay(250));
    }

    return this.http
      .delete<ResponseEnvelope<unknown>>(`${this.base}/v1/account`)
      .pipe(map(() => undefined));
  }
}

/**
 * What each role grants (`RoleScopes.cs`). Demo mode only — everywhere else the scopes arrive on
 * the row, so this mapping is never the thing a screen renders from.
 */
const ScopesForRole: Record<MemberRole, string[]> = {
  admin: ['scan:write', 'scan:read', 'report:read'],
  analyst: ['scan:write', 'scan:read', 'report:read'],
  viewer: ['scan:read', 'report:read'],
};

/**
 * The tenant the offline demo signs into, as three people rather than one.
 *
 * Module-level and mutated in place by `changeMemberRole` so a demo role change survives leaving
 * the screen and coming back — a members table that silently reverts would demonstrate the
 * opposite of what the feature does. It resets on reload, which is what "demo" means.
 */
const DemoMembers: MemberDto[] = [
  {
    userId: 'demo-user-1',
    email: 'admin@example.com',
    role: 'admin',
    scopes: ['scan:write', 'scan:read', 'report:read'],
    isEmailVerified: true,
    createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
  },
  {
    userId: 'demo-user-2',
    email: 'analyst@example.com',
    role: 'analyst',
    scopes: ['scan:write', 'scan:read', 'report:read'],
    isEmailVerified: true,
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  },
  {
    userId: 'demo-user-3',
    email: 'viewer@example.com',
    role: 'viewer',
    scopes: ['scan:read', 'report:read'],
    isEmailVerified: false,
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
];
