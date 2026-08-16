import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../config/environment';

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
  role: string;
  scopes: string[];
  expiresAt: string;
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

  login(email: string, password: string): Observable<Session> {
    if (environment.useDemoData) {
      // Demo mode has no backend to authenticate against. A local session keeps the login
      // step in the flow — the screen is still gated, and the guard and interceptor are still
      // exercised — without pretending a credential was verified.
      const session: Session = {
        accessToken: 'demo-token',
        refreshToken: 'demo-refresh',
        tenantId: 'demo-tenant',
        role: 'analyst',
        scopes: ['scan:read', 'report:read'],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
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

  /** Drops the session locally. Called on sign-out and by the interceptor on a 401. */
  logout(): void {
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
    role: tokens.role,
    scopes: tokens.scopes ?? [],
    expiresAt: tokens.accessTokenExpiresAt,
  };
}

/**
 * Reads a stored session back on reload, discarding one that has already expired.
 *
 * Restoring an expired token would send it, get a 401, and bounce the user to the login page
 * anyway — but only after a failed request, which reads as a broken screen rather than a
 * finished session.
 */
function restore(): Session | null {
  const raw = localStorage.getItem(StorageKey);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as Session;
    if (!session.accessToken) return null;
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(StorageKey);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(StorageKey);
    return null;
  }
}
