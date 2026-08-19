import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ScanApi } from '../../core/api/scan-api';
import { Finding, GraphEdge, GraphNode, ResourceGraph } from '../../core/api/wire';
import { ResourceGraphPage } from './resource-graph-page';

function node(key: string, layer: GraphNode['layer'], isHot = false): GraphNode {
  return { node_key: key, type: layer === 'dep' ? 'pkg' : 'code', layer, is_hot: isHot };
}

function edge(
  from: string,
  to: string,
  confidence: GraphEdge['confidence'],
  oriented = true,
): GraphEdge {
  return {
    from,
    to,
    relation: 'reaches',
    seam: 'dep-code',
    confidence,
    oriented_attack_dir: oriented,
  };
}

const graph: ResourceGraph = {
  scan_job_id: 's1',
  nodes: [node('pkg:newtonsoft', 'dep'), node('code:orders', 'code', true), node('s3:data', 'infra')],
  edges: [edge('pkg:newtonsoft', 'code:orders', 'certain'), edge('code:orders', 's3:data', 'inferred')],
};

const findings: Finding[] = [
  {
    id: 'f1',
    source_tool: 'osv-scanner',
    layer: 'dep',
    severity: 4,
    cwe_id: 'CWE-502',
    cve_id: 'CVE-2024-0001',
    node_ref: 'pkg:newtonsoft',
    message: 'vulnerable deserialization',
    redacted: false,
  },
];

describe('ResourceGraphPage', () => {
  function render(api: Partial<ScanApi>) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ScanApi, useValue: api },
      ],
    });

    const fixture = TestBed.createComponent(ResourceGraphPage);
    fixture.componentRef.setInput('id', 's1');
    fixture.detectChanges();
    return fixture;
  }

  function loaded() {
    return render({
      getGraph: () => of(graph),
      getFindings: () => of({ items: findings, next_cursor: null, limit: 50 }),
    } as unknown as Partial<ScanApi>);
  }

  it('lays every node out in its layer column and keeps both endpoints of every edge', () => {
    const page = loaded().componentInstance;
    const layout = page.layout();

    expect(layout.nodes.length).toBe(3);
    expect(layout.edges.length).toBe(2);

    // dep is drawn left of code, code left of infra — reading the canvas left to right is
    // meant to read the claim the product makes.
    const x = new Map(layout.nodes.map((p) => [p.node.node_key, p.x]));
    expect(x.get('pkg:newtonsoft')!).toBeLessThan(x.get('code:orders')!);
    expect(x.get('code:orders')!).toBeLessThan(x.get('s3:data')!);
  });

  it('drops an edge whose endpoint the graph did not return, rather than blanking the canvas', () => {
    // A missing endpoint places at NaN, and one NaN in a path attribute takes the whole SVG
    // down. Losing one edge is the cheaper failure.
    const page = render({
      getGraph: () => of({ ...graph, edges: [...graph.edges, edge('code:orders', 'ghost', 'certain')] }),
      getFindings: () => of({ items: [], next_cursor: null, limit: 50 }),
    } as unknown as Partial<ScanApi>).componentInstance;

    expect(page.layout().edges.length).toBe(2);
    expect(page.layout().edges.every((e) => Number.isFinite(e.from.x) && Number.isFinite(e.to.x))).toBe(
      true,
    );
  });

  it('attaches findings to the node they reference', () => {
    const page = loaded().componentInstance;
    const placed = page.layout().nodes.find((p) => p.node.node_key === 'pkg:newtonsoft');

    expect(placed?.findings.map((f) => f.id)).toEqual(['f1']);
  });

  it('still draws the graph when findings cannot be read', () => {
    // Evidence is enrichment; the topology is the point. A failed findings call must not cost
    // the picture.
    const page = render({
      getGraph: () => of(graph),
      getFindings: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    } as unknown as Partial<ScanApi>).componentInstance;

    expect(page.layout().nodes.length).toBe(3);
    expect(page.error()).toBeNull();
  });

  it('counts hot nodes for the summary', () => {
    const page = loaded().componentInstance;

    expect(page.hotCount()).toBe(1);
    expect(page.summary()).toContain('3 nodes');
    expect(page.summary()).toContain('2 edges');
  });

  it('selects the node a deep link names, and toggles selection off on a second click', () => {
    const fixture = loaded();
    const page = fixture.componentInstance;

    fixture.componentRef.setInput('node', 'code:orders');
    fixture.detectChanges();
    expect(page.selected()?.node.node_key).toBe('code:orders');
    expect(page.inbound().length).toBe(1);
    expect(page.outbound().length).toBe(1);

    page.select('code:orders');
    expect(page.selected()).toBeNull();
  });

  it('dims a filtered-out layer instead of removing it from the drawing', () => {
    const page = loaded().componentInstance;

    page.setLayerFilter('infra');

    expect(page.dimmed('dep')).toBe(true);
    expect(page.dimmed('infra')).toBe(false);
    // The node is still placed — an edge cannot end at something that is not there.
    expect(page.layout().nodes.length).toBe(3);
  });

  it('renders an empty graph as a stage that has not run, not as a failure', () => {
    const page = render({
      getGraph: () => of({ scan_job_id: 's1', nodes: [], edges: [] }),
      getFindings: () => of({ items: [], next_cursor: null, limit: 50 }),
    } as unknown as Partial<ScanApi>).componentInstance;

    expect(page.error()).toBeNull();
    expect(page.layout().nodes.length).toBe(0);
  });

  it('surfaces a failed graph read', () => {
    const page = render({
      getGraph: () => throwError(() => new HttpErrorResponse({ status: 404 })),
      getFindings: () => of({ items: [], next_cursor: null, limit: 50 }),
    } as unknown as Partial<ScanApi>).componentInstance;

    expect(page.error()).toBeTruthy();
    expect(page.loading()).toBe(false);
  });
});
