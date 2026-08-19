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
        blue_verdict: 'confirmed',
        edge_confidence: null,
        finding_id: 'f1',
        node_key: 'code:orderscontroller',
      },
      {
        order: 2,
        technique_id: 'T1530',
        blue_validated: false,
        blue_verdict: 'unresolved',
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

  it('reports partial confirmation as partial, never as confirmed', () => {
    // The most expensive lie this screen could tell: one unconfirmed hop rounded up to a
    // confirmed chain.
    const text = (render().nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Blue confirmed 1 of 2 steps');
    expect(text).not.toContain('Blue confirmed every step');
  });

  it('does not report an unjudged chain as one Blue rejected', () => {
    // Audit 42-A: every hop is born `unassessed`, and the old card counted that as
    // "Blue validated 0 of N steps" — a sentence that reads as a finding when nobody has
    // looked. The two states must not share a sentence.
    const unjudged: Chain = {
      ...chain,
      status: 'candidate',
      hops: chain.hops.map((hop) => ({
        ...hop,
        blue_validated: false,
        blue_verdict: 'unassessed' as const,
      })),
    };

    const text = (render(unjudged).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No debate has judged this chain yet');
    expect(text).not.toContain('Blue confirmed 0 of 2 steps');
  });

  it('states a refutation as a refutation, and not as an unsettled step', () => {
    const refuted: Chain = {
      ...chain,
      hops: [chain.hops[0], { ...chain.hops[1], blue_verdict: 'refuted' as const }],
    };

    const text = (render(refuted).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Blue contradicted 1 of 2 steps');
  });

  it('renders a hop with no grounded technique without linking to one', () => {
    // An empty technique_id appended to MITRE's technique URL is a link to their index wearing
    // the label of a specific technique. Audit 42-A found exactly that on every chain.
    const untyped: Chain = {
      ...chain,
      hops: [{ ...chain.hops[0], technique_id: '' }, chain.hops[1]],
    };

    const fixture = render(untyped);
    const host = fixture.nativeElement as HTMLElement;

    const links = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(links).not.toContain('https://attack.mitre.org/techniques/');
    expect(host.textContent ?? '').toContain('No ATT&CK technique was grounded');
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
