import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, delay, map, of, throwError } from 'rxjs';

import { environment } from '../config/environment';
import { ResponseEnvelope } from './wire';

/**
 * A project on the wire (`ProjectResponse.cs`).
 *
 * camelCase: this DTO carries no `[JsonPropertyName]` attributes, so it serializes with the
 * API's default policy — like `ScanJobResponse`, unlike the SEC-40 read views in `wire.ts`.
 * There is deliberately no `tenantId` field: the caller's tenant comes from their token, never
 * echoed back on a row.
 */
export interface ProjectDto {
  projectId: string;
  repoUrl: string;
  defaultBranch: string;
  githubInstallationId: string | null;
}

/**
 * Registers the repositories a tenant may submit scans for (`ProjectController`).
 *
 * `create` is admin-only on the backend — it changes what the tenant *is* — so the caller
 * should gate the create form on `auth.role() === 'admin'`; `list` has no role gate, since
 * reading which repositories your own tenant scans is what any signed-in viewer needs to make
 * sense of a report.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** Every project the caller's tenant owns, ordered by repo URL. */
  list(): Observable<ProjectDto[]> {
    if (environment.useDemoData) {
      return this.demo([
        {
          projectId: 'demo-project-1',
          repoUrl: 'https://github.com/example/sentinelai-demo',
          defaultBranch: 'main',
          githubInstallationId: null,
        },
      ]);
    }

    return this.http
      .get<ResponseEnvelope<ProjectDto[]>>(`${this.base}/v1/projects`)
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Registers a repository. Re-registering the same `(tenant, repoUrl)` pair is not treated as
   * an error here: the backend answers 409 carrying the *existing* project's id rather than a
   * second one, so a 409 is unwrapped the same as a 201 — the caller gets a usable project
   * either way, which is the whole point of the backend making re-registration idempotent.
   */
  create(repoUrl: string, defaultBranch?: string, githubInstallationId?: string): Observable<ProjectDto> {
    if (environment.useDemoData) {
      return this.demo({
        projectId: 'demo-project-1',
        repoUrl,
        defaultBranch: defaultBranch || 'main',
        githubInstallationId: githubInstallationId || null,
      });
    }

    return this.http
      .post<ResponseEnvelope<ProjectDto>>(`${this.base}/v1/projects`, {
        repoUrl,
        defaultBranch: defaultBranch || null,
        githubInstallationId: githubInstallationId || null,
      })
      .pipe(
        map((envelope) => envelope.data),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 409) {
            const envelope = error.error as ResponseEnvelope<ProjectDto> | null;
            if (envelope?.data) return of(envelope.data);
          }
          return throwError(() => error);
        }),
      );
  }

  /** A visible pause, so loading states are exercised in demo mode rather than never seen. */
  private demo<T>(value: T): Observable<T> {
    return of(value).pipe(delay(250));
  }
}
