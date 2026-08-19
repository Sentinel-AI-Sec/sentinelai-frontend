import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { Recents } from '../../core/history/recents';
import { BundleMetadataInput, ScanOpsApi, SubmitScanResponse } from '../../core/api/scan-ops-api';
import { environment } from '../../core/config/environment';

/**
 * Submits a scan bundle (`POST /v1/scans`) — the multipart upload the GitHub Action normally
 * performs, exposed here so it can be exercised without a running workflow. Requires the
 * `scan:write` scope, which every human role (`admin`, `analyst`) is issued; only `viewer`
 * lacks it.
 *
 * The screen shows the `metadata.json` part it is about to send, live. That part is a contract
 * with the backend — snake_case keys, an object for `scanner_versions`, not a string — and the
 * failures it causes are 400s with no obvious cause. Showing the JSON costs nothing (it is
 * built from the same signals either way) and turns "rejected" into something readable.
 */
@Component({
  selector: 'app-new-scan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './new-scan-page.html',
  styleUrl: './new-scan-page.css',
})
export class NewScanPage {
  private readonly api = inject(ScanOpsApi);
  private readonly router = inject(Router);
  private readonly recents = inject(Recents);
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

  /** Purely visual: whether a file is currently being dragged over the drop zone. */
  readonly dragging = signal(false);

  readonly canWrite = this.auth.hasScope('scan:write');
  readonly demoMode = environment.useDemoData;

  /** Whether `scanner_versions` currently parses. Surfaced beside the field rather than only
   *  on submit, since it is the one input here that can be malformed in a silent way. */
  readonly scannerVersionsValid = computed(() => {
    try {
      JSON.parse(this.scannerVersionsJson() || '{}');
      return true;
    } catch {
      return false;
    }
  });

  /** The metadata part as it will be serialised, or the reason it cannot be. */
  readonly metadataPreview = computed(() => {
    let scannerVersions: unknown = {};
    try {
      scannerVersions = JSON.parse(this.scannerVersionsJson() || '{}');
    } catch {
      return '// scanner_versions is not valid JSON — fix it to see the metadata part';
    }

    return JSON.stringify(
      {
        project_id: this.projectId().trim(),
        pr_ref: this.prRef().trim(),
        commit_sha: this.commitSha().trim(),
        model_tier_hint: this.modelTierHint(),
        retain_report: this.retainReport(),
        runner_secret_scan: this.runnerSecretScan(),
        scanner_versions: scannerVersions,
        artifacts: [],
      },
      null,
      2,
    );
  });

  readonly bundleLabel = computed(() => {
    const file = this.bundleFile();
    if (!file) return null;
    const kb = file.size / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} kB`;
  });

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.bundleFile.set(input.files?.[0] ?? null);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.bundleFile.set(file);
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
        this.remember(response.scanJobId, metadata.project_id || undefined);
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

  /**
   * Adds the job to this browser's jump list, so the id the API just minted is reachable from
   * the side nav rather than only from this one response. `note` is keyed by tenant and no-ops
   * without one, so a submit that succeeded is never reported as failed by the index.
   */
  private remember(scanJobId: string, label?: string): void {
    this.recents.note('scan', scanJobId, label);
  }
}

function bodyDetail(err: HttpErrorResponse): string | undefined {
  const body = err.error as { message?: string; detail?: string } | null;
  return body?.message ?? body?.detail;
}
