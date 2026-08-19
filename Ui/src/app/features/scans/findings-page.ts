import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';

import { ScanApi } from '../../core/api/scan-api';
import { Finding, Layer } from '../../core/api/wire';
import { ScanTabs } from './scan-tabs';

const SeverityLabel = ['none', 'low', 'medium', 'high', 'critical'] as const;

const LayerLabel: Record<Layer, string> = {
  dep: 'Dependency',
  code: 'Code',
  infra: 'Infra',
};

/** The API clamps at 200; 50 is a page a person can actually read before deciding to go on. */
const PageSize = 50;

/**
 * Every finding on one scan (`GET /v1/scans/{id}/findings`), filterable and paged.
 *
 * The filters are passed to the server rather than applied here, because the endpoint takes
 * them (`layer`, `min_severity`) and a client-side filter over one fetched page would quietly
 * mean something different: "the high-severity findings on this page" rather than "the
 * high-severity findings". Changing a filter therefore restarts paging from the first page.
 *
 * The severity strip counts what is *loaded*, and says so. Under a cursor it cannot honestly
 * claim to count the scan.
 */
@Component({
  selector: 'app-findings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ScanTabs],
  templateUrl: './findings-page.html',
  styleUrl: './findings-page.css',
})
export class FindingsPage {
  private readonly api = inject(ScanApi);

  /** Bound from the route: /scans/:id/findings */
  readonly id = input.required<string>();

  readonly findings = signal<Finding[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly appliedLimit = signal<number>(PageSize);

  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);

  readonly layer = signal<Layer | 'all'>('all');
  readonly minSeverity = signal(0);

  readonly layers: readonly Layer[] = ['code', 'dep', 'infra'] as const;
  readonly layerLabel = LayerLabel;
  readonly severities = [0, 1, 2, 3, 4] as const;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.reload(id));
    });
  }

  /** How the loaded rows break down by severity — a shape, not a total. */
  readonly counts = computed(() => {
    const buckets = [0, 0, 0, 0, 0];
    for (const finding of this.findings()) {
      const index = Math.min(Math.max(finding.severity, 0), 4);
      buckets[index] += 1;
    }
    return buckets;
  });

  readonly redactedCount = computed(() => this.findings().filter((f) => f.redacted).length);

  severityLabel(severity: number): string {
    return SeverityLabel[severity] ?? String(severity);
  }

  setLayer(layer: Layer | 'all'): void {
    if (this.layer() === layer) return;
    this.layer.set(layer);
    this.reload(this.id());
  }

  setMinSeverity(severity: number): void {
    if (this.minSeverity() === severity) return;
    this.minSeverity.set(severity);
    this.reload(this.id());
  }

  retry(): void {
    this.reload(this.id());
  }

  loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;

    this.loadingMore.set(true);

    this.api.getFindings(this.id(), { ...this.query(), cursor }).subscribe({
      next: (page) => {
        this.findings.update((existing) => [...existing, ...(page.items ?? [])]);
        this.nextCursor.set(page.next_cursor);
        this.appliedLimit.set(page.limit);
        this.loadingMore.set(false);
      },
      error: (err: unknown) => {
        this.loadingMore.set(false);
        this.error.set(describe(err));
      },
    });
  }

  private reload(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.findings.set([]);
    this.nextCursor.set(null);

    this.api.getFindings(id, this.query()).subscribe({
      next: (page) => {
        this.findings.set(page.items ?? []);
        this.nextCursor.set(page.next_cursor);
        this.appliedLimit.set(page.limit);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describe(err));
      },
    });
  }

  /** `minSeverity: 0` is omitted rather than sent — "at least none" is not a filter, and
   *  leaving it off keeps the request identical to the unfiltered one. */
  private query(): { limit: number; layer?: string; minSeverity?: number } {
    const layer = this.layer();
    const minSeverity = this.minSeverity();
    return {
      limit: PageSize,
      ...(layer === 'all' ? {} : { layer }),
      ...(minSeverity > 0 ? { minSeverity } : {}),
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Could not reach the backend. Is the API running?';
    if (error.status === 404) return 'No such scan — or it belongs to another tenant.';
    if (error.status === 403) return 'Your account does not have permission to read these findings.';
    const body = error.error as { detail?: string; title?: string } | null;
    return body?.detail ?? body?.title ?? `Request failed (${error.status}).`;
  }
  return 'Something went wrong loading the findings.';
}
