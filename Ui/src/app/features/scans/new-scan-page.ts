import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { BundleMetadataInput, ScanOpsApi, SubmitScanResponse } from '../../core/api/scan-ops-api';
import { environment } from '../../core/config/environment';

/**
 * Submits a scan bundle (`POST /v1/scans`) — the multipart upload the GitHub Action normally
 * performs, exposed here so it can be exercised without a running workflow. Requires the
 * `scan:write` scope, which every human role (`admin`, `analyst`) is issued; only `viewer`
 * lacks it.
 */
@Component({
  selector: 'app-new-scan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './new-scan-page.html',
  styleUrls: ['../../shared/forms.css', './new-scan-page.css'],
})
export class NewScanPage {
  private readonly api = inject(ScanOpsApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);

  readonly projectId = signal('');
  readonly prRef = signal('');
  readonly commitSha = signal('');
  readonly modelTierHint = signal<'auto' | 'economy' | 'premium'>('auto');
  readonly retainReport = signal(true);
  readonly runnerSecretScan = signal<'passed' | 'failed' | 'skipped'>('skipped');
  readonly scannerVersionsJson = signal('{}');
  readonly bundleFile = signal<File | null>(null);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitted = signal<SubmitScanResponse | null>(null);

  readonly canWrite = this.auth.hasScope('scan:write');
  readonly demoMode = environment.useDemoData;

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.bundleFile.set(input.files?.[0] ?? null);
  }

  submit(): void {
    if (this.submitting()) return;

    const bundle = this.bundleFile();
    if (!bundle) {
      this.error.set('Choose a .tar.gz bundle to upload.');
      return;
    }

    let scannerVersions: Record<string, unknown>;
    try {
      scannerVersions = JSON.parse(this.scannerVersionsJson() || '{}') as Record<string, unknown>;
    } catch {
      this.error.set('Scanner versions must be valid JSON.');
      return;
    }

    const metadata: BundleMetadataInput = {
      project_id: this.projectId().trim(),
      pr_ref: this.prRef().trim(),
      commit_sha: this.commitSha().trim(),
      model_tier_hint: this.modelTierHint(),
      retain_report: this.retainReport(),
      runner_secret_scan: this.runnerSecretScan(),
      scanner_versions: scannerVersions,
      artifacts: [],
    };

    this.submitting.set(true);
    this.error.set(null);
    this.submitted.set(null);

    this.api.submit(metadata, bundle).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.submitted.set(response);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 403
            ? "This token is missing the 'scan:write' scope."
            : err instanceof HttpErrorResponse && err.status === 400
              ? `Rejected: ${bodyDetail(err) ?? 'check the project id and bundle.'}`
              : 'Could not submit the bundle.',
        );
      },
    });
  }

  openOps(): void {
    const job = this.submitted();
    if (job) void this.router.navigate(['/scans', job.scanJobId, 'ops']);
  }
}

function bodyDetail(err: HttpErrorResponse): string | undefined {
  const body = err.error as { message?: string; detail?: string } | null;
  return body?.message ?? body?.detail;
}
