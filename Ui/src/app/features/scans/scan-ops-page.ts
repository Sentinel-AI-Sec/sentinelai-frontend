import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { ScanApi } from '../../core/api/scan-api';
import {
  RunAuditStageResponse,
  RunGraphStageResponse,
  ScanOpsApi,
} from '../../core/api/scan-ops-api';
import { ScanJobResponse, ScanStageName, ScanStatusName } from '../../core/api/wire';
import { environment } from '../../core/config/environment';

/**
 * Manually drives one scan job through the stages a queue-driven worker will eventually run
 * (`POST /v1/scans/{id}/graph`, `.../audit`, `.../purge`) — the ops surface `ScanController`'s
 * own remarks describe as how the pipeline is exercised end to end today, with no worker yet.
 */
@Component({
  selector: 'app-scan-ops-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './scan-ops-page.html',
  styleUrls: ['../../shared/forms.css', './scan-ops-page.css'],
})
export class ScanOpsPage {
  private readonly scanApi = inject(ScanApi);
  private readonly opsApi = inject(ScanOpsApi);
  protected readonly auth = inject(Auth);

  /** Bound from the route: /scans/:id/ops */
  readonly id = input.required<string>();

  readonly job = signal<ScanJobResponse | null>(null);
  readonly jobLoading = signal(true);
  readonly jobError = signal<string | null>(null);

  readonly graphRunning = signal(false);
  readonly graphResult = signal<RunGraphStageResponse | null>(null);
  readonly graphError = signal<string | null>(null);

  readonly auditRunning = signal(false);
  readonly auditResult = signal<RunAuditStageResponse | null>(null);
  readonly auditError = signal<string | null>(null);

  readonly purging = signal(false);
  readonly purgeError = signal<string | null>(null);

  readonly canWrite = this.auth.hasScope('scan:write');
  readonly isAdmin = this.auth.role() === 'admin';
  readonly demoMode = environment.useDemoData;

  readonly ScanStatusName = ScanStatusName;
  readonly ScanStageName = ScanStageName;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.loadJob(id));
    });
  }

  loadJob(id: string): void {
    this.jobLoading.set(true);
    this.jobError.set(null);

    this.scanApi.getScanJob(id).subscribe({
      next: (job) => {
        this.job.set(job);
        this.jobLoading.set(false);
      },
      error: () => {
        this.jobLoading.set(false);
        this.jobError.set('Could not load this scan job — check the id.');
      },
    });
  }

  runGraphStage(): void {
    if (this.graphRunning()) return;

    this.graphRunning.set(true);
    this.graphError.set(null);

    this.opsApi.runGraphStage(this.id()).subscribe({
      next: (result) => {
        this.graphRunning.set(false);
        this.graphResult.set(result);
        this.loadJob(this.id());
      },
      error: (err: unknown) => {
        this.graphRunning.set(false);
        this.graphError.set(describeError(err));
      },
    });
  }

  runAuditStage(): void {
    if (this.auditRunning()) return;

    this.auditRunning.set(true);
    this.auditError.set(null);

    this.opsApi.runAuditStage(this.id()).subscribe({
      next: (result) => {
        this.auditRunning.set(false);
        this.auditResult.set(result);
        this.loadJob(this.id());
      },
      error: (err: unknown) => {
        this.auditRunning.set(false);
        this.auditError.set(describeError(err));
      },
    });
  }

  purge(): void {
    if (this.purging()) return;
    if (!window.confirm('Purge this job’s stored bundle? This cannot be undone.')) return;

    this.purging.set(true);
    this.purgeError.set(null);

    this.opsApi.purge(this.id()).subscribe({
      next: (job) => {
        this.purging.set(false);
        this.job.set(job);
      },
      error: (err: unknown) => {
        this.purging.set(false);
        this.purgeError.set(describeError(err));
      },
    });
  }
}

function describeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 403) return 'Not permitted — check the token’s role and scopes.';
    if (err.status === 404) return 'No such scan job.';
    if (err.status === 409) return 'This job has no stored bundle yet.';
    if (err.status === 410) return 'This job’s bundle has already been purged.';
    const body = err.error as { message?: string } | null;
    return body?.message ?? `Request failed (${err.status}).`;
  }
  return 'Something went wrong.';
}
