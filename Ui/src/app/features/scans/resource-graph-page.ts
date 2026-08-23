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
import { catchError, of, switchMap } from 'rxjs';

import { ScanApi } from '../../core/api/scan-api';
import {
  Confidence,
  Finding,
  GraphEdge,
  GraphNode,
  Layer,
  Page,
  ResourceGraph,
} from '../../core/api/wire';
import { ScanTabs } from './scan-tabs';

/** A node with the position the layout gave it and the evidence that points at it. */
export interface PlacedNode {
  node: GraphNode;
  x: number;
  y: number;
  findings: Finding[];
}

/** An edge with both endpoints resolved and its curve pre-computed. */
export interface PlacedEdge {
  edge: GraphEdge;
  from: PlacedNode;
  to: PlacedNode;
  path: string;
}

interface GraphLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

/** Layer order, left to right, and it is the product's own sentence: a dependency reaches
 *  code, code reaches infrastructure. Reading the canvas left to right reads the claim. */
const LayerOrder: readonly Layer[] = ['dep', 'code', 'infra'] as const;

const NodeRadius = 26;
const CanvasWidth = 960;
const RowGap = 88;
const TopMargin = 76;

/** Node type shortened to something that fits inside a 26px circle without a font fallback. */
const TypeAbbrev: Record<string, string> = {
  pkg: 'PKG',
  code: 'CODE',
  image: 'IMG',
  task: 'TASK',
  role: 'ROLE',
  resource: 'RES',
};

const TypeIcon: Record<string, string> = {
  pkg: 'inventory_2',
  code: 'code',
  image: 'deployed_code',
  task: 'settings_applications',
  role: 'key',
  resource: 'database',
};

const LayerLabel: Record<Layer, string> = {
  dep: 'Dependency',
  code: 'Application code',
  infra: 'Infrastructure',
};

const SeverityLabel = ['none', 'low', 'medium', 'high', 'critical'] as const;

/**
 * The resource graph for one scan (`GET /v1/scans/{id}/graph`), drawn.
 *
 * The layout is deterministic and computed here rather than force-directed: a security graph
 * that settles somewhere different on every load cannot be talked about ("the node on the
 * left") and cannot be compared between two scans of the same repository. Columns by layer,
 * stable vertical order as the API returned them — the same bundle always draws the same
 * picture.
 *
 * Confidence is carried by the *edges*, because that is what it describes — the join, not the
 * thing joined. `unresolved` is dashed as well as coloured so the weakest links survive a
 * greyscale screenshot.
 */
@Component({
  selector: 'app-resource-graph-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ScanTabs],
  templateUrl: './resource-graph-page.html',
  styleUrl: './resource-graph-page.css',
})
export class ResourceGraphPage {
  private readonly api = inject(ScanApi);

  /** Bound from the route: /scans/:id/graph */
  readonly id = input.required<string>();

  /**
   * Bound from `?node=` — `withComponentInputBinding()` feeds query params to inputs by name.
   * The findings table links here with a node ref, and this is what makes that link land on
   * the node rather than merely on the page.
   */
  readonly node = input<string>();

  readonly graph = signal<ResourceGraph | null>(null);
  readonly findings = signal<Finding[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly selectedKey = signal<string | null>(null);
  readonly layerFilter = signal<Layer | 'all'>('all');

  readonly layers = LayerOrder;
  readonly layerLabel = LayerLabel;
  readonly typeIcon = TypeIcon;
  readonly nodeRadius = NodeRadius;

  /**
   * How far the drawing is scaled up from "fit the box".
   *
   * 1 is the whole graph fitted to the canvas, which is what this screen has always shown and
   * what it still opens at. Above 1 the SVG is rendered larger than its container and the canvas
   * scrolls, so zooming in never puts a node somewhere unreachable — the alternative, shrinking
   * the viewBox around the centre, magnifies the middle and quietly hides the edges.
   *
   * Below 1 is deliberately not offered. Fitted is already the whole graph; "smaller than
   * everything" is a worse view of the same information, and on a 69-node graph the labels are
   * unreadable well before it would help.
   */
  readonly zoom = signal(1);

  /** Bounds and step. 3x is where a 26px node fills a comfortable fraction of the canvas. */
  private static readonly MinZoom = 1;
  private static readonly MaxZoom = 3;
  private static readonly ZoomStep = 0.25;

  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));
  readonly canZoomIn = computed(() => this.zoom() < ResourceGraphPage.MaxZoom);
  readonly canZoomOut = computed(() => this.zoom() > ResourceGraphPage.MinZoom);

  zoomIn(): void {
    this.setZoom(this.zoom() + ResourceGraphPage.ZoomStep);
  }

  zoomOut(): void {
    this.setZoom(this.zoom() - ResourceGraphPage.ZoomStep);
  }

  /** Back to the whole graph. Worth its own control: scrolling back to "fitted" by hand is fiddly. */
  resetZoom(): void {
    this.setZoom(1);
  }

  private setZoom(value: number): void {
    const clamped = Math.min(
      ResourceGraphPage.MaxZoom,
      Math.max(ResourceGraphPage.MinZoom, Math.round(value * 100) / 100),
    );
    this.zoom.set(clamped);
  }


  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });

    // A deep link carries its node in the URL; selecting it here rather than in `load` means
    // it also works when only the query param changes and the graph is already on screen.
    effect(() => {
      const key = this.node();
      if (key) untracked(() => this.selectedKey.set(key));
    });
  }

  readonly layout = computed<GraphLayout>(() => {
    const graph = this.graph();
    if (!graph || graph.nodes.length === 0) {
      return { nodes: [], edges: [], width: CanvasWidth, height: 260 };
    }

    const findingsByNode = new Map<string, Finding[]>();
    for (const finding of this.findings()) {
      const bucket = findingsByNode.get(finding.node_ref);
      if (bucket) bucket.push(finding);
      else findingsByNode.set(finding.node_ref, [finding]);
    }

    // Only layers that actually have nodes get a column, so a graph made entirely of infra
    // does not draw itself squashed against the right-hand edge of two empty ones.
    const columns = LayerOrder.filter((layer) => graph.nodes.some((n) => n.layer === layer));
    const columnWidth = CanvasWidth / Math.max(columns.length, 1);

    const placed: PlacedNode[] = [];
    let tallest = 1;

    columns.forEach((layer, columnIndex) => {
      const inLayer = graph.nodes.filter((n) => n.layer === layer);
      tallest = Math.max(tallest, inLayer.length);

      inLayer.forEach((node, rowIndex) => {
        placed.push({
          node,
          x: columnWidth * (columnIndex + 0.5),
          y: TopMargin + rowIndex * RowGap,
          findings: findingsByNode.get(node.node_key) ?? [],
        });
      });
    });

    const byKey = new Map(placed.map((p) => [p.node.node_key, p]));

    // An edge naming a node the graph did not return would place at NaN and blank the whole
    // canvas, so it is dropped rather than drawn. That should not happen; if it does, losing
    // one edge beats losing the picture.
    const edges: PlacedEdge[] = [];
    for (const edge of graph.edges) {
      const from = byKey.get(edge.from);
      const to = byKey.get(edge.to);
      if (from && to) edges.push({ edge, from, to, path: curve(from, to) });
    }

    return {
      nodes: placed,
      edges,
      width: CanvasWidth,
      height: TopMargin + tallest * RowGap,
    };
  });

  readonly hotCount = computed(() => this.layout().nodes.filter((p) => p.node.is_hot).length);

  readonly summary = computed(() => {
    const { nodes, edges } = this.layout();
    return `${nodes.length} nodes, ${edges.length} edges, ${this.hotCount()} flagged hot`;
  });

  readonly selected = computed<PlacedNode | null>(() => {
    const key = this.selectedKey();
    if (!key) return null;
    return this.layout().nodes.find((p) => p.node.node_key === key) ?? null;
  });

  readonly inbound = computed<PlacedEdge[]>(() => {
    const key = this.selected()?.node.node_key;
    return key ? this.layout().edges.filter((e) => e.edge.to === key) : [];
  });

  readonly outbound = computed<PlacedEdge[]>(() => {
    const key = this.selected()?.node.node_key;
    return key ? this.layout().edges.filter((e) => e.edge.from === key) : [];
  });

  /** Dimming rather than hiding: a filtered-out node is still an endpoint of a drawn edge, and
   *  removing it mid-path would make the remaining edges point at nothing. */
  dimmed(layer: Layer): boolean {
    const filter = this.layerFilter();
    return filter !== 'all' && filter !== layer;
  }

  edgeDimmed(edge: PlacedEdge): boolean {
    return this.dimmed(edge.from.node.layer) || this.dimmed(edge.to.node.layer);
  }

  select(key: string): void {
    this.selectedKey.update((current) => (current === key ? null : key));
  }

  setLayerFilter(layer: Layer | 'all'): void {
    this.layerFilter.set(layer);
  }

  abbrev(type: string): string {
    return TypeAbbrev[type] ?? type.slice(0, 4).toUpperCase();
  }

  icon(type: string): string {
    return TypeIcon[type] ?? 'circle';
  }

  severityLabel(severity: number): string {
    return SeverityLabel[severity] ?? String(severity);
  }

  /**
   * A node key with its type prefix dropped, since the column it sits in already says that:
   * `code:orderscontroller` reads as `orderscontroller`.
   *
   * Only the *first* colon is cut. Splitting on the last one turned
   * `pkg:newtonsoft.json:12.0.1` into `12.0.1` — a version number with no package attached,
   * which is not a shorter label, it is a different and useless one. Anything still too long
   * is elided in the middle, because on a package key both ends carry meaning.
   */
  shortKey(key: string): string {
    const colon = key.indexOf(':');
    const tail = colon >= 0 ? key.slice(colon + 1) : key;
    if (tail.length <= 24) return tail;
    return `${tail.slice(0, 11)}…${tail.slice(-10)}`;
  }

  confidenceHint(level: Confidence | null): string {
    switch (level) {
      case 'certain':
        return 'Confirmed against the real configuration.';
      case 'inferred':
        return 'Convention-based — an image-name match rather than a digest, for example.';
      case 'unresolved':
        return 'Could not be confirmed from the artifacts in this bundle.';
      default:
        return 'No confidence was recorded for this join.';
    }
  }

  copyKey(): void {
    const key = this.selected()?.node.node_key;
    // Clipboard access is a permission, not a guarantee — a copy that silently does nothing is
    // preferable to a rejected promise taking the page down with it.
    if (key) void navigator.clipboard?.writeText(key).catch(() => undefined);
  }

  retry(): void {
    this.load(this.id());
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.graph.set(null);
    this.findings.set([]);

    this.api
      .getGraph(id)
      .pipe(
        switchMap((graph) => {
          this.graph.set(graph);
          // Findings annotate the picture; they are not the picture. If that call fails the
          // topology still draws, minus the evidence counts.
          return this.api
            .getFindings(id, { limit: 200 })
            .pipe(catchError(() => of({ items: [], next_cursor: null, limit: 0 } as Page<Finding>)));
        }),
      )
      .subscribe({
        next: (page) => {
          this.findings.set(page.items ?? []);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(describe(err));
        },
      });
  }
}

/**
 * A cubic between two placed nodes, leaving and arriving horizontally so the curve reads as a
 * flow across the columns. Same-column edges bow out to the right instead of collapsing into a
 * straight vertical line that would be indistinguishable from the column itself.
 */
function curve(from: PlacedNode, to: PlacedNode): string {
  const dx = to.x - from.x;
  const bend = Math.max(60, Math.abs(dx) / 2);
  // The arrowhead is drawn at the end of the path, so the path stops short of the target ring.
  const gap = NodeRadius + 9;

  if (dx === 0) {
    const loop = NodeRadius + 110;
    return `M ${from.x + NodeRadius} ${from.y} C ${from.x + loop} ${from.y}, ${to.x + loop} ${to.y}, ${to.x + gap} ${to.y}`;
  }

  const direction = dx > 0 ? 1 : -1;
  const startX = from.x + direction * NodeRadius;
  const endX = to.x - direction * gap;

  return `M ${startX} ${from.y} C ${startX + direction * bend} ${from.y}, ${endX - direction * bend} ${to.y}, ${endX} ${to.y}`;
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Could not reach the backend. Is the API running?';
    if (error.status === 404) return 'No such scan — or it belongs to another tenant.';
    if (error.status === 403) return 'Your account does not have permission to read this graph.';
    const body = error.error as { detail?: string; title?: string } | null;
    return body?.detail ?? body?.title ?? `Request failed (${error.status}).`;
  }
  return 'Something went wrong loading the resource graph.';
}
