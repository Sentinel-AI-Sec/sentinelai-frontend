import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Chain, Confidence, Finding, GraphNode, Layer, NodeType } from '../../core/api/wire';

/**
 * A real exploit chain, drawn in the same visual language as the home page's illustration.
 *
 * <h3>Why this exists</h3>
 *
 * The dashboard and the pricing page carry `ChainIllustration` — a hand-authored SVG of the
 * fixture's flagship chain — and its own docs promise that "the real graph, the same vocabulary,
 * drawn from real data" is what a reader gets once they open a scan. Until now that promise was
 * only half kept: the real chains rendered as a vertical list of hops, which is a different
 * picture in a different idiom. A reader who learned the diagram on the way in had to learn a
 * second representation on arrival.
 *
 * So this is the illustration's grammar — layer bands, circular typed nodes, tier-coloured joins,
 * the dashed unresolved edge — fed from a `Chain` the backend actually produced.
 *
 * <h3>What it will not do</h3>
 *
 * <b>It draws only what the data says.</b> A hop carries a `node_key` and the confidence of the
 * join that reached it; it does not carry a layer. Where the scan's resource graph has been loaded
 * the layer is read from it, and where it has not, the band is simply absent rather than guessed
 * from the shape of a string. The illustration can afford to be certain about six nodes it was
 * authored around; a drawing of someone's real infrastructure cannot.
 *
 * The same rule governs the target halo (the last hop, which is what the chain claims to reach)
 * and the ghost treatment (a hop Blue positively refuted). Both are read from the row, never
 * inferred from position alone.
 */
@Component({
  selector: 'app-chain-diagram',
  templateUrl: './chain-diagram.html',
  styleUrl: './chain-diagram.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainDiagram {
  readonly chain = input.required<Chain>();

  /**
   * The scan's graph nodes, keyed by `node_key`, when the caller has them.
   *
   * Optional on purpose: the report endpoint returns chains without the graph, so a screen that
   * has not fetched it still gets a correct drawing — just one without layer bands.
   */
  readonly nodesByKey = input<Map<string, GraphNode>>(new Map());

  /** Findings by id, so a hop can show the CWE that put it on the path. */
  readonly findingsById = input<Map<string, Finding>>(new Map());

  /** Geometry, matching the illustration's proportions so the two read as one drawing. */
  private static readonly NODE_R = 26;
  private static readonly STEP_X = 158;
  private static readonly MARGIN_X = 83;
  private static readonly ROW_Y = 110;

  readonly nodes = computed<DiagramNode[]>(() => {
    const graph = this.nodesByKey();
    const findings = this.findingsById();

    return this.chain()
      .hops.slice()
      .sort((a, b) => a.order - b.order)
      .map((hop, index) => {
        const key = hop.node_key ?? '';
        const node = graph.get(key);
        const finding = hop.finding_id ? findings.get(hop.finding_id) : undefined;
        const parts = key.split(':');

        return {
          x: ChainDiagram.MARGIN_X + index * ChainDiagram.STEP_X,
          y: ChainDiagram.ROW_Y,
          // The type badge inside the circle. From the graph where we have it, and from the
          // key's own prefix where we do not — that prefix is the backend's own naming, not a
          // guess about what the thing is.
          type: (node?.type ?? (parts[0] || 'node')).toUpperCase(),
          layer: node?.layer ?? null,
          label: parts.length > 1 ? parts[1] : key || 'unknown',
          // A version if the key carries one, otherwise the finding that put this hop on the
          // path. Never both — the sub line is one line.
          sub: parts.length > 2 ? parts[2] : (finding?.cwe_id ?? finding?.cve_id ?? null),
          subIsFinding: parts.length <= 2 && Boolean(finding?.cwe_id ?? finding?.cve_id),
          // The join that reached this hop. The seed hop arrived from nowhere and has none.
          joinFromPrevious: index === 0 ? null : hop.edge_confidence,
          // Blue positively contradicted this hop. Distinct from "nobody looked", which is the
          // state most hops are in and which must not be drawn as a judgement.
          refuted: hop.blue_verdict === 'refuted',
          isTarget: false,
        };
      })
      .map((node, index, all) => ({ ...node, isTarget: index === all.length - 1 }));
  });

  /** Wide enough for the hops it has, so a two-hop chain is not stretched across a 900px box. */
  readonly width = computed(() => {
    const count = Math.max(this.nodes().length, 1);
    return ChainDiagram.MARGIN_X * 2 + ChainDiagram.STEP_X * (count - 1);
  });

  readonly viewBox = computed(() => `0 0 ${this.width()} 220`);

  /**
   * Layer bands, one per run of consecutive hops sharing a layer.
   *
   * Runs rather than one band per layer, because a chain can legitimately re-enter a layer it has
   * already left. Hops whose layer is unknown produce no band at all.
   */
  readonly bands = computed<DiagramBand[]>(() => {
    const nodes = this.nodes();
    const bands: DiagramBand[] = [];

    for (const node of nodes) {
      if (node.layer === null) continue;

      const last = bands.at(-1);

      if (last && last.layer === node.layer && last.endX + ChainDiagram.STEP_X >= node.x) {
        last.endX = node.x;
        continue;
      }

      bands.push({ layer: node.layer, startX: node.x, endX: node.x });
    }

    return bands;
  });

  /** The join lines between consecutive nodes. */
  readonly edges = computed<DiagramEdge[]>(() =>
    this.nodes()
      .slice(1)
      .map((node, index) => {
        const from = this.nodes()[index];
        return {
          d: `M ${from.x + ChainDiagram.NODE_R} ${from.y} L ${node.x - ChainDiagram.NODE_R} ${node.y}`,
          confidence: node.joinFromPrevious,
        };
      }),
  );

  bandX(band: DiagramBand): number {
    return band.startX - ChainDiagram.NODE_R - 12;
  }

  bandWidth(band: DiagramBand): number {
    return band.endX - band.startX + (ChainDiagram.NODE_R + 12) * 2;
  }

  bandLabelX(band: DiagramBand): number {
    return (band.startX + band.endX) / 2;
  }

  /** `dep` reads as DEPENDENCY on the band, matching the illustration's wording. */
  bandLabel(layer: Layer): string {
    return layer === 'dep' ? 'DEPENDENCY' : layer.toUpperCase();
  }

  /** Null confidence is the seed hop's absent join, drawn as certain rather than as a tier. */
  edgeClass(confidence: Confidence | null): string {
    return `cd-edge cd-edge--${confidence ?? 'certain'}`;
  }

  markerUrl(confidence: Confidence | null): string {
    return `url(#cd-arrow-${confidence ?? 'certain'})`;
  }
}

interface DiagramNode {
  x: number;
  y: number;
  type: string;
  layer: Layer | null;
  label: string;
  sub: string | null;
  subIsFinding: boolean;
  joinFromPrevious: Confidence | null;
  refuted: boolean;
  isTarget: boolean;
}

interface DiagramBand {
  layer: Layer;
  startX: number;
  endX: number;
}

interface DiagramEdge {
  d: string;
  confidence: Confidence | null;
}

/** Re-exported so a template can narrow without importing the wire module. */
export type { NodeType };
