import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Chain, ChainHop, Finding, GraphNode } from '../../core/api/wire';
import { ChainDiagram } from './chain-diagram';

function hop(overrides: Partial<ChainHop> = {}): ChainHop {
  return {
    order: 1,
    technique_id: '',
    blue_validated: false,
    blue_verdict: 'unassessed',
    edge_confidence: 'certain',
    finding_id: null,
    node_key: 'pkg:newtonsoft.json:12.0.1',
    ...overrides,
  };
}

function chain(hops: ChainHop[]): Chain {
  return {
    id: 'c1',
    priority: 1,
    hop_count: hops.length,
    status: 'validated',
    min_confidence: 'inferred',
    hops,
  };
}

function node(key: string, layer: GraphNode['layer'], type: GraphNode['type']): GraphNode {
  return { node_key: key, type, layer, is_hot: false };
}

function render(c: Chain, nodes: GraphNode[] = [], findings: Finding[] = []) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const fixture = TestBed.createComponent(ChainDiagram);
  fixture.componentRef.setInput('chain', c);
  fixture.componentRef.setInput('nodesByKey', new Map(nodes.map((n) => [n.node_key, n])));
  fixture.componentRef.setInput('findingsById', new Map(findings.map((f) => [f.id, f])));
  fixture.detectChanges();
  return fixture;
}

describe('ChainDiagram', () => {
  it('draws one node per hop, in order', () => {
    const fixture = render(
      chain([
        hop({ order: 2, node_key: 'code:orderscontroller' }),
        hop({ order: 1, node_key: 'pkg:newtonsoft.json:12.0.1' }),
      ]),
    );

    // Given out of order deliberately: hop.order is the path, not array position.
    expect(fixture.componentInstance.nodes().map((n) => n.label)).toEqual([
      'newtonsoft.json',
      'orderscontroller',
    ]);
  });

  it('draws one fewer join than nodes, since the seed hop arrived from nowhere', () => {
    const fixture = render(
      chain([
        hop({ order: 1, node_key: 'pkg:a', edge_confidence: null }),
        hop({ order: 2, node_key: 'code:b', edge_confidence: 'inferred' }),
        hop({ order: 3, node_key: 's3:c', edge_confidence: 'certain' }),
      ]),
    );

    const edges = fixture.componentInstance.edges();
    expect(edges.length).toBe(2);
    expect(edges.map((e) => e.confidence)).toEqual(['inferred', 'certain']);
  });

  it('carries each join’s own confidence into its class and marker', () => {
    // The tier vocabulary is the point of the drawing: an unresolved join must not be drawn as a
    // certain one, and hue alone is not allowed to carry it (the CSS dashes it too).
    const component = render(chain([hop()])).componentInstance;

    expect(component.edgeClass('unresolved')).toContain('cd-edge--unresolved');
    expect(component.edgeClass('inferred')).toContain('cd-edge--inferred');
    expect(component.markerUrl('unresolved')).toBe('url(#cd-arrow-unresolved)');
  });

  it('reads layers from the graph rather than guessing them from node keys', () => {
    const c = chain([
      hop({ order: 1, node_key: 'pkg:newtonsoft.json:12.0.1' }),
      hop({ order: 2, node_key: 'code:orderscontroller' }),
    ]);

    const withoutGraph = render(c).componentInstance;
    expect(withoutGraph.bands().length).toBe(0);
    expect(withoutGraph.nodes().every((n) => n.layer === null)).toBe(true);

    const withGraph = render(c, [
      node('pkg:newtonsoft.json:12.0.1', 'dep', 'pkg'),
      node('code:orderscontroller', 'code', 'code'),
    ]).componentInstance;

    expect(withGraph.bands().map((b) => b.layer)).toEqual(['dep', 'code']);
  });

  it('groups consecutive hops in one layer into a single band', () => {
    const fixture = render(
      chain([
        hop({ order: 1, node_key: 'task:order' }),
        hop({ order: 2, node_key: 'iam_role:order_task_role' }),
        hop({ order: 3, node_key: 's3:customer-data' }),
      ]),
      [
        node('task:order', 'infra', 'task'),
        node('iam_role:order_task_role', 'infra', 'role'),
        node('s3:customer-data', 'infra', 'resource'),
      ],
    );

    const bands = fixture.componentInstance.bands();
    expect(bands.length).toBe(1);
    expect(bands[0].layer).toBe('infra');
  });

  it('marks only the last hop as the target', () => {
    // The halo is a claim about what the chain reaches, so exactly one node may wear it.
    const fixture = render(
      chain([
        hop({ order: 1, node_key: 'pkg:a' }),
        hop({ order: 2, node_key: 's3:customer-data' }),
      ]),
    );

    expect(fixture.componentInstance.nodes().map((n) => n.isTarget)).toEqual([false, true]);
  });

  it('ghosts a refuted hop and nothing else', () => {
    // `unassessed` and `unattributed` mean nobody looked. Drawing those as doubt would invent a
    // judgement the debate never made — the exact defect audit 42-A was about.
    const fixture = render(
      chain([
        hop({ order: 1, node_key: 'pkg:a', blue_verdict: 'unassessed' }),
        hop({ order: 2, node_key: 'code:b', blue_verdict: 'unattributed' }),
        hop({ order: 3, node_key: 's3:c', blue_verdict: 'refuted' }),
      ]),
    );

    expect(fixture.componentInstance.nodes().map((n) => n.refuted)).toEqual([false, false, true]);
  });

  it('widens with the chain rather than stretching a short one', () => {
    const two = render(chain([hop({ order: 1 }), hop({ order: 2, node_key: 'code:b' })]));
    const four = render(
      chain([
        hop({ order: 1 }),
        hop({ order: 2, node_key: 'code:b' }),
        hop({ order: 3, node_key: 'task:c' }),
        hop({ order: 4, node_key: 's3:d' }),
      ]),
    );

    expect(four.componentInstance.width()).toBeGreaterThan(two.componentInstance.width());
  });

  it('labels the dependency band in full', () => {
    // The illustration says DEPENDENCY, not DEP. Two drawings of the same thing must not disagree.
    expect(render(chain([hop()])).componentInstance.bandLabel('dep')).toBe('DEPENDENCY');
  });
});
