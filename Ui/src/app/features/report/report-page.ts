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
import { Recents } from '../../core/history/recents';
import { Confidence, Finding, GraphNode, Report } from '../../core/api/wire';
import { ChainDiagram } from '../../shared/chain-diagram/chain-diagram';
import { ChainCard } from './chain-card';
import { DraftBanner } from './draft-banner';

/** One severity band of the posture bar. Bands with no findings are dropped before render. */
export interface SeverityBand {
  level: number;
  label: string;
  count: number;
  percent: number;
}

/** Weakest first. A chain is only as good as its worst join, and so is a whole report. */
const ConfidenceRank: Record<Confidence, number> = {
  unresolved: 0,
  inferred: 1,
  certain: 2,
};

const SeverityLabels = ['none', 'low', 'medium', 'high', 'critical'];

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
  imports: [ChainCard, ChainDiagram, DraftBanner, RouterLink, DatePipe, CurrencyPipe],
  templateUrl: './report-page.html',
  styleUrl: './report-page.css',
})
export class ReportPage {
  private readonly api = inject(ScanApi);
  private readonly auth = inject(Auth);
  private readonly recents = inject(Recents);

  /** Bound from the route: /reports/:id */
  readonly id = input.required<string>();

  readonly report = signal<Report | null>(null);
  readonly findings = signal<Finding[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly tenantId = this.auth.tenantId;

  /**
   * The scan's graph nodes, so a chain can be drawn with its real layer bands.
   *
   * Best-effort and separate from the report: `GET /v1/reports/{id}` returns chains without the
   * graph, and a chain draws correctly without it — just without bands. Failing the whole screen
   * because a supplementary read failed would be trading the thing the reader came for against a
   * decoration.
   */
  readonly graphNodes = signal<GraphNode[]>([]);

  readonly nodesByKey = computed(
    () => new Map(this.graphNodes().map((node) => [node.node_key, node])),
  );

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

  /**
   * The weakest join anywhere in the live chains — the headline number a reader should carry
   * away. Reported across chains for the same reason each chain reports its own: an audit that
   * advertised its strongest link would be describing a report nobody received.
   */
  readonly weakestJoin = computed<Confidence | null>(() => {
    const chains = this.liveChains();
    if (chains.length === 0) return null;

    return chains.reduce<Confidence>(
      (weakest, chain) =>
        ConfidenceRank[chain.min_confidence] < ConfidenceRank[weakest]
          ? chain.min_confidence
          : weakest,
      chains[0].min_confidence,
    );
  });

  /**
   * Severity mix across the scan's findings, worst first.
   *
   * Empty when findings did not load — the template shows a note instead. A zeroed bar would
   * claim the scan found nothing, which is a different and much more reassuring statement than
   * "the evidence call failed".
   */
  readonly severityBands = computed<SeverityBand[]>(() => {
    const findings = this.findings();
    if (findings.length === 0) return [];

    const counts = [0, 0, 0, 0, 0];
    for (const finding of findings) {
      // A scanner is free to send a severity outside 0–4; clamping keeps it in the palette
      // rather than silently dropping the finding from the posture.
      counts[Math.min(Math.max(Math.trunc(finding.severity), 0), 4)] += 1;
    }

    return counts
      .map((count, level) => ({
        level,
        label: SeverityLabels[level] ?? String(level),
        count,
        percent: (count / findings.length) * 100,
      }))
      .filter((band) => band.count > 0)
      .reverse();
  });

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
    this.graphNodes.set([]);

    this.api
      .getReport(id)
      .pipe(
        switchMap((report) => {
          this.report.set(report);
          // Both ids go into the jump list: whoever opened a report will want the scan behind
          // it next, and the API has no way to enumerate either.
          this.recents.note('report', id);
          this.recents.note('scan', report.scan_job_id);

          // The graph is fetched for one reason: it is the only place a hop's LAYER is stated.
          // A chain row carries a node key and the confidence of the join that reached it, and
          // nothing about which layer that node lives in — so without this the diagram draws the
          // path correctly and simply has no bands. Best-effort, in parallel with the evidence.
          this.api
            .getGraph(report.scan_job_id)
            .pipe(catchError(() => of({ nodes: [] as GraphNode[] })))
            .subscribe((graph) => this.graphNodes.set(graph.nodes ?? []));

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

  print(): void {
    window.print();
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
