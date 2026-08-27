import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { environment } from '../config/environment';
import { Area, UiRole, canSee, toUiRole } from './roles';

/**
 * What `POST /v1/auth/login` returns inside the envelope.
 *
 * camelCase here, snake_case in `wire.ts`, and that is not an inconsistency on our side: the
 * read DTOs carry explicit `[JsonPropertyName]` attributes and the auth ones do not, so the
 * two halves of the API genuinely serialize differently. Transcribed as-sent rather than
 * normalized, because a guess here fails as a silently undefined token.
 */
export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tenantId: string;
  userId: string;
  role: string;
  scopes: string[];
}

/** The `Response` wrapper every auth endpoint returns. Read endpoints unwrap theirs; these don't. */
interface Envelope<T> {
  statusCode: number;
  isSuccess: boolean;
  data: T;
  message: string;
}

/** What we keep about the signed-in user. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  tenantId: string;

  /**
   * Who is signed in. Optional because a session stored before this field existed is still
   * restored rather than discarded — a schema addition should not sign everybody out. Screens
   * that use it must therefore treat "unknown" as a real case; the members table does, by
   * falling back to the API's own refusal rather than assuming a row is not the caller's.
   */
  userId?: string;

  role: string;
  scopes: string[];
  expiresAt: string;
  /** When the refresh token itself expires — what actually ends the session, now that {@link Auth.refresh} exists. */
  refreshExpiresAt: string;
}

const StorageKey = 'sentinelai.session';

/**
 * Holds the signed-in session and hands the token to the interceptor.
 *
 * <b>The tenant is never sent by us and never chosen here.</b> It is a claim inside the token,
 * enforced by the backend's query filter on every read (SEC-32). This service stores
 * `tenantId` only so the screen can display whose data is shown — a UI that passed a tenant id
 * to the API would be inviting the caller to ask for someone else's, which is exactly the
 * mistake the backend's design exists to make impossible.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly state = signal<Session | null>(restore());

  readonly session = this.state.asReadonly();
  readonly isAuthenticated = computed(() => this.state() !== null);
  readonly role = computed(() => this.state()?.role ?? null);
  readonly tenantId = computed(() => this.state()?.tenantId ?? null);

  /** The signed-in user's id, or null when the stored session predates the field. */
  readonly userId = computed(() => this.state()?.userId ?? null);

  /**
   * The signed-in role as the console names it — `user`, `admin` or `dev` — translated from
   * the backend's claim by {@link toUiRole}. {@link role} still returns the claim verbatim,
   * because the account screen shows what the token actually says.
   */
  readonly uiRole = computed<UiRole>(() => toUiRole(this.state()?.role));

  /** Whether the current session's token was issued with the given scope (SEC-32). */
  hasScope(scope: string): boolean {
    return this.state()?.scopes.includes(scope) ?? false;
  }

  /**
   * Whether the signed-in role reaches an area of the console.
   *
   * A method rather than a computed because it takes an argument, and reactive all the same:
   * it reads {@link uiRole}, so a template calling `auth.canSee('debate')` is re-evaluated when
   * the session changes — the nav rebuilds itself on sign-out without anything subscribing.
   */
  canSee(area: Area): boolean {
    return canSee(this.uiRole(), area);
  }

  /**
   * Self-service sign-up: always creates a brand-new tenant with the registering user as its
   * first admin (`POST /v1/auth/register`). Joining an existing tenant is a separate,
   * invite-only flow this screen does not offer.
   */
  register(email: string, password: string, tenantName: string): Observable<Session> {
    if (environment.useDemoData) {
      return this.login(email, password);
    }

    return this.http
      .post<Envelope<AuthTokens>>(`${environment.apiBaseUrl}/v1/auth/register`, {
        email,
        password,
        tenantName,
      })
      .pipe(
        map((envelope) => toSession(envelope.data)),
        tap((session) => this.persist(session)),
      );
  }

  login(email: string, password: string): Observable<Session> {
    if (environment.useDemoData) {
      // Demo mode has no backend to authenticate against. A local session keeps the login
      // step in the flow — the screen is still gated, and the guard and interceptor are still
      // exercised — without pretending a credential was verified.
      const session: Session = {
        accessToken: 'demo-token',
        refreshToken: 'demo-refresh',
        tenantId: 'demo-tenant',
        // Matches the admin row in `AccountApi`'s demo members, so the members table shows the
        // self-row as un-editable the way it does against a real backend.
        userId: 'demo-user-1',
        role: 'analyst',
        scopes: ['scan:read', 'report:read'],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      };
      this.persist(session);
      return new Observable<Session>((subscriber) => {
        subscriber.next(session);
        subscriber.complete();
      });
    }

    return this.http
      .post<Envelope<AuthTokens>>(`${environment.apiBaseUrl}/v1/auth/login`, { email, password })
      .pipe(
        map((envelope) => toSession(envelope.data)),
        tap((session) => this.persist(session)),
      );
  }

  /**
   * Trades the still-valid refresh token for a new access/refresh pair (`POST /v1/auth/refresh`).
   * Called by the interceptor when a request comes back 401 with an expired access token, so a
   * live session survives past the access token's lifetime without forcing a re-login.
   *
   * On success the rotated pair replaces the stored session (the presented refresh token is
   * revoked by the backend, so the old one could not be reused anyway). Throws through to the
   * caller on failure — an expired or revoked refresh token means the session really is over.
   */
  refresh(): Observable<Session> {
    const current = this.state();
    if (!current) throw new Error('no session to refresh');

    return this.http
      .post<Envelope<AuthTokens>>(`${environment.apiBaseUrl}/v1/auth/refresh`, {
        refreshToken: current.refreshToken,
      })
      .pipe(
        map((envelope) => toSession(envelope.data)),
        tap((session) => this.persist(session)),
      );
  }

  /**
   * Signs out: revokes the refresh token server-side (`POST /v1/auth/logout`) so it cannot be
   * replayed, then drops the session locally either way — a backend that is unreachable should
   * not be able to trap someone in a signed-in browser tab.
   */
  logout(): Observable<void> {
    const current = this.state();
    if (environment.useDemoData || !current) {
      this.dropSession();
      return of(undefined);
    }

    return this.http
      .post(`${environment.apiBaseUrl}/v1/auth/logout`, { refreshToken: current.refreshToken })
      .pipe(
        catchError(() => of(null)),
        tap(() => this.dropSession()),
        map(() => undefined),
      );
  }

  /**
   * Drops the session locally without calling the backend. Used by the interceptor when a
   * refresh attempt itself fails — at that point the refresh token is already invalid, so
   * asking the backend to revoke it again would only add a request that is expected to fail.
   */
  dropSession(): void {
    this.state.set(null);
    localStorage.removeItem(StorageKey);
  }

  private persist(session: Session): void {
    this.state.set(session);
    localStorage.setItem(StorageKey, JSON.stringify(session));
  }
}

function toSession(tokens: AuthTokens): Session {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tenantId: tokens.tenantId,
    userId: tokens.userId,
    role: tokens.role,
    scopes: tokens.scopes ?? [],
    expiresAt: tokens.accessTokenExpiresAt,
    refreshExpiresAt: tokens.refreshTokenExpiresAt,
  };
}

/**
 * Reads a stored session back on reload, discarding one whose refresh token has already
 * expired.
 *
 * Checked against the refresh token's expiry, not the access token's: the access token is
 * typically the shorter-lived of the two (an hour, against 30 days for the refresh token), and
 * {@link Auth.refresh} exists precisely so an expired access token does not end the session by
 * itself. Discarding here on the access token's expiry would sign someone out on every page
 * reload past the first hour despite holding a perfectly good refresh token — the interceptor
 * would never get the chance to use it.
 */
function restore(): Session | null {
  const raw = localStorage.getItem(StorageKey);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as Session;
    if (!session.accessToken || !session.refreshToken) return null;

    // No refreshExpiresAt (a session stored before this field existed, or a malformed one) is
    // treated as already expired rather than as never-expiring — the safe direction to guess
    // wrong in is "ask them to sign in again", not "keep a session open forever".
    const refreshExpiry = session.refreshExpiresAt ? new Date(session.refreshExpiresAt).getTime() : NaN;
    if (!(refreshExpiry > Date.now())) {
      localStorage.removeItem(StorageKey);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(StorageKey);
    return null;
  }
}
