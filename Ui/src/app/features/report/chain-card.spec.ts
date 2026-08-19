import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Chain, Finding } from '../../core/api/wire';
import { ChainCard } from './chain-card';

/**
 * SEC-42's acceptance, at the component that carries it: hops in order, the evidence behind
 * each, and a confidence tier that is never rounded up.
 */
describe('ChainCard', () => {
  const finding: Finding = {
    id: 'f1',
    source_tool: 'roslyn',
    layer: 'code',
    severity: 4,
    cwe_id: 'CWE-502',
    cve_id: null,
    node_ref: 'code:orderscontroller',
    message: 'Unsafe deserialization via TypeNameHandling.All.',
    redacted: false,
  };

  const chain: Chain = {
    id: 'c1',
    priority: 1,
    hop_count: 2,
    status: 'validated',
    min_confidence: 'inferred',
    hops: [
      {
        order: 1,
        technique_id: 'T1190',
        blue_validated: true,
        edge_confidence: null,
        finding_id: 'f1',
        node_key: 'code:orderscontroller',
      },
      {
        order: 2,
        technique_id: 'T1530',
        blue_validated: false,
        edge_confidence: 'inferred',
        finding_id: null,
        node_key: 's3:customer-data',
      },
    ],
  };

  function render(input: Chain = chain) {
    const fixture = TestBed.createComponent(ChainCard);
    fixture.componentRef.setInput('chain', input);
    fixture.componentRef.setInput('findingsById', new Map([[finding.id, finding]]));
    fixture.detectChanges();
    return fixture;
  }

  it('shows every hop, its technique and its node', () => {
    const text = (render().nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('code:orderscontroller');
    expect(text).toContain('s3:customer-data');
    expect(text).toContain('T1190');
    expect(text).toContain('T1530');
  });

  it('shows the finding that evidences a hop', () => {
    const text = (render().nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Unsafe deserialization');
    expect(text).toContain('CWE-502');
    expect(text).toContain('critical');
  });

  it('says a hop has no finding rather than leaving it blank', () => {
    // A silent gap reads as a rendering bug. Naming it says the node is on the path because of
    // how it connects, which is a real and different thing.
    const text = (render().nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No finding on this node');
  });

  it('reports partial validation as partial, never as validated', () => {
    // The most expensive lie this screen could tell: one unvalidated hop rounded up to a
    // validated chain.
    const text = (render().nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Blue validated 1 of 2 steps');
    expect(text).not.toContain('Blue validated every step');
  });

  it('shows the weakest join, not the strongest', () => {
    const text = (render().nativeElement as HTMLElement).textContent ?? '';

    expect(text.toLowerCase()).toContain('inferred');
  });

  it('marks an unresolved join as unresolved', () => {
    const unresolved: Chain = {
      ...chain,
      min_confidence: 'unresolved',
      hops: [chain.hops[0], { ...chain.hops[1], edge_confidence: 'unresolved' }],
    };

    const text = (render(unresolved).nativeElement as HTMLElement).textContent ?? '';

    expect(text.toLowerCase()).toContain('unresolved');
  });
});
