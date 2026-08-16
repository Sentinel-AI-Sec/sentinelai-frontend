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
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { switchMap, of, catchError } from 'rxjs';

import { ScanApi } from '../../core/api/scan-api';
import { Auth } from '../../core/auth/auth';
import { Finding, Report } from '../../core/api/wire';
import { ChainCard } from './chain-card';
import { DraftBanner } from './draft-banner';

/**
 * The draft audit for one report: what was found, what it chains to, and how sure we are.
 *
 * Findings are fetched alongside the report because a chain hop references a finding by id
 * only — without them, "the evidence behind each step" is a set of GUIDs. They are loaded
 * best-effort: if that call fails the chains still render, minus their evidence, because a
 * partial audit is more use than an error page.
 */
@Component({
  selector: 'app-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChainCard, DraftBanner, RouterLink, DatePipe, CurrencyPipe],
  templateUrl: './report-page.html',
  styleUrl: './report-page.css',
})
export class ReportPage {
  private readonly api = inject(ScanApi);
  private readonly auth = inject(Auth);

  /** Bound from the route: /reports/:id */
  readonly id = input.required<string>();

  readonly report = signal<Report | null>(null);
  readonly findings = signal<Finding[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly tenantId = this.auth.tenantId;

  readonly findingsById = computed(
    () => new Map(this.findings().map((finding) => [finding.id, finding])),
  );

  /**
   * Chains worth acting on first. Rejected ones stay visible, but below.
   *
   * `rejected` is the backend's spelling (`ChainStatus.Rejected`), even though the heading
   * calls it "refuted by Blue" — that is the debate's language and the clearer phrase for a
   * reader. The value and the label are allowed to differ; matching on the label would not be.
   */
  readonly liveChains = computed(
    () => this.report()?.chains.filter((c) => c.status !== 'rejected') ?? [],
  );

  readonly rejectedChains = computed(
    () => this.report()?.chains.filter((c) => c.status === 'rejected') ?? [],
  );

  constructor() {
    // An effect rather than a one-shot load, because the router reuses this component when only
    // the :id segment changes. Loading once at construction left the previous report on screen
    // under the new URL — a reader looking at someone else's audit with nothing to indicate it
    // was stale, which in a multi-tenant product is the worst kind of wrong.
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    // Drop the previous report immediately, so a slow fetch cannot leave the old one visible
    // while the new URL is already in the address bar.
    this.report.set(null);
    this.findings.set([]);

    this.api
      .getReport(id)
      .pipe(
        switchMap((report) => {
          this.report.set(report);
          return this.api.getFindings(report.scan_job_id).pipe(
            // Evidence is a nice-to-have; the chains are the point. Degrade, don't fail.
            catchError(() => of({ items: [] as Finding[] })),
          );
        }),
      )
      .subscribe({
        next: (page) => {
          this.findings.set(page.items ?? []);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(describe(err));
          this.loading.set(false);
        },
      });
  }

  retry(): void {
    this.load(this.id());
  }
}

/** Turns a failed request into something a person can act on. */
function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'Could not reach the backend. Is the API running?';
    }
    if (error.status === 404) {
      return 'No such report — or it belongs to another tenant.';
    }
    if (error.status === 403) {
      return 'Your account does not have permission to read this report.';
    }
    // RFC 7807: the API sends a real explanation rather than a raw exception, so show it.
    const detail = (error.error as { detail?: string; title?: string } | null)?.detail;
    const title = (error.error as { title?: string } | null)?.title;
    return detail ?? title ?? `Request failed (${error.status}).`;
  }

  return 'Something went wrong loading this report.';
}
