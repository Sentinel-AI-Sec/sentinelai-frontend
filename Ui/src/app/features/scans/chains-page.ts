import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { of, catchError, forkJoin } from 'rxjs';

import { ScanApi } from '../../core/api/scan-api';
import { Chain, Finding, GraphNode } from '../../core/api/wire';
import { ChainDiagram } from '../../shared/chain-diagram/chain-diagram';
import { ChainCard } from '../report/chain-card';
import { ScanTabs } from './scan-tabs';

/**
 * The chains one scan found, drawn.
 *
 * <h3>Why this is a scan view and not only a report view</h3>
 *
 * Chains were previously reachable through the draft audit alone — and a report exists only where
 * the submitter opted into retention (SEC-35: silence means delete). So a scan could carry
 * forty-eight candidate chains that nobody could look at, because the audit that would have
 * addressed them was discarded as asked. `GET /v1/scans/{id}/chains` has always served them; this
 * is the screen that reads it.
 *
 * <h3>What it shows and what it refuses to</h3>
 *
 * The same drawing the dashboard illustrates and the report renders: layer bands, typed nodes,
 * joins coloured by the confidence the traverser assigned. Underneath each one, the card that
 * carries what a picture cannot — per-hop verdicts, the evidence, the ATT&CK technique.
 *
 * <b>These are candidates, not conclusions.</b> A chain here has usually not been through the
 * debate: its hops read `unassessed`, which means nobody has looked, not that nothing was found.
 * The header says so, because a page of confident-looking diagrams is exactly the claim this
 * product exists not to make.
 */
@Component({
  selector: 'app-chains-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChainDiagram, ChainCard, ScanTabs],
  templateUrl: './chains-page.html',
  styleUrl: './chains-page.css',
})
export class ChainsPage {
  private readonly api = inject(ScanApi);

  readonly id = input.required<string>();

  readonly chains = signal<Chain[]>([]);
  readonly graphNodes = signal<GraphNode[]>([]);
  readonly findings = signal<Finding[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly nextCursor = signal<string | null>(null);
  readonly loadingMore = signal(false);

  /** Layer lookup for the diagram's bands. Absent graph simply means no bands. */
  readonly nodesByKey = computed(
    () => new Map(this.graphNodes().map((node) => [node.node_key, node])),
  );

  readonly findingsById = computed(
    () => new Map(this.findings().map((finding) => [finding.id, finding])),
  );

  /**
   * Whether any hop on this scan has been adjudicated.
   *
   * Drives the "not yet debated" note. Read from the rows rather than from the stage, because a
   * scan can reach the report stage with chains the debate never reasoned over.
   */
  readonly adjudicated = computed(() =>
    this.chains().some((chain) => chain.hops.some((hop) => hop.blue_verdict !== 'unassessed')),
  );

  readonly hasMore = computed(() => this.nextCursor() !== null);

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.load(id);
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.chains.set([]);

    // The graph and the findings are supporting detail: the graph resolves each hop's layer, the
    // findings resolve its evidence. Neither is worth failing the page over, so both degrade to
    // empty and the chains still draw.
    forkJoin({
      chains: this.api.getChains(id, undefined, 25),
      graph: this.api.getGraph(id).pipe(catchError(() => of({ nodes: [] as GraphNode[] }))),
      findings: this.api
        .getFindings(id, { limit: 200 })
        .pipe(catchError(() => of({ items: [] as Finding[] }))),
    }).subscribe({
      next: ({ chains, graph, findings }) => {
        this.chains.set(chains.items ?? []);
        this.nextCursor.set(chains.next_cursor);
        this.graphNodes.set(graph.nodes ?? []);
        this.findings.set(findings.items ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not read the chains for this scan.');
      },
    });
  }

  loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;

    this.loadingMore.set(true);

    this.api.getChains(this.id(), cursor, 25).subscribe({
      next: (page) => {
        this.chains.update((rows) => [...rows, ...(page.items ?? [])]);
        this.nextCursor.set(page.next_cursor);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loadingMore.set(false);
        this.error.set('Could not read the next page of chains.');
      },
    });
  }

  retry(): void {
    this.load(this.id());
  }
}
