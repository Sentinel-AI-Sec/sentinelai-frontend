import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DebateApi, DebateHopView, DebateResponse, DebateTurnView } from '../../core/api/debate-api';
import { DebatePage } from './debate-page';

const response: DebateResponse = {
  scanJobId: 's1',
  outcome: 'ChainConfirmed',
  weakestJoin: 'Inferred',
  rounds: 2,
  turns: 1,
  terminatedByTurnCap: false,
  summary: 'summary text',
  transcript: [
    { role: 'Red', round: 1, confidence: 'Inferred', tier: 'High', tokens: 100, content: 'turn content' },
  ],
  disclaimer: 'draft only',
  edgeIntegrityWarnings: ['edge warning'],
  abandonedReasoningWarnings: [],
  cost: {
    currency: 'USD',
    total: 0.2,
    modelCalls: 2,
    totalTokens: 200,
    rated: true,
    measured: true,
    byTier: [],
  },
};

/** A hop with everything present, so a test can vary the one field it is about. */
function hop(over: Partial<DebateHopView> = {}): DebateHopView {
  return {
    order: 1,
    from: 'N6',
    to: 'N8',
    fromLabel: 'iam_role:api-task-role',
    toLabel: 's3:customer-data-bucket',
    relation: 'can-access',
    technique: 'T1078',
    verdict: 'Confirmed',
    graphStatus: 'confirmed',
    evidence: 'F4 grants s3:GetObject',
    text: 'HOP 1: N6 -> can-access -> N8 | T1078 | F4 grants s3:GetObject',
    ...over,
  };
}

/** A turn carrying one structured hop and nothing else. */
function structuredTurn(over: Partial<DebateHopView> = {}, verdict: string | null = null): DebateTurnView {
  return {
    role: 'Red',
    round: 1,
    confidence: 'Certain',
    tier: 'High',
    tokens: 100,
    content: 'HOP 1: N6 -> can-access -> N8 | T1078 | F4 grants s3:GetObject',
    display: { headline: null, hops: [hop(over)], facts: [], notes: [], verdict, isEmpty: false },
  };
}

describe('DebatePage', () => {
  function render(run?: () => ReturnType<DebateApi['run']>, runDemo?: () => ReturnType<DebateApi['runDemo']>) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DebateApi, useValue: { run, runDemo } },
      ],
    });

    const fixture = TestBed.createComponent(DebatePage);
    fixture.detectChanges();
    return fixture;
  }

  it('passes trimmed inputs through to run()', () => {
    const run = vi.fn(() => of(response));
    const fixture = render(run);

    fixture.componentInstance.scanJobId.set('  s1  ');
    fixture.componentInstance.resourceGraph.set('  graph  ');
    fixture.componentInstance.run();

    expect(run).toHaveBeenCalledWith('s1', 'graph');
  });

  it('sends undefined, not empty strings, when both fields are left blank', () => {
    const run = vi.fn(() => of(response));
    const fixture = render(run);

    fixture.componentInstance.run();

    expect(run).toHaveBeenCalledWith(undefined, undefined);
  });

  it('runs the AID-01 fixture through runDemo(), not run()', () => {
    const run = vi.fn(() => of(response));
    const runDemo = vi.fn(() => of(response));
    const fixture = render(run, runDemo);

    fixture.componentInstance.runDemo();

    expect(runDemo).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('renders the outcome, cost, transcript and integrity warnings on success', () => {
    const fixture = render(() => of(response));

    fixture.componentInstance.run();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('ChainConfirmed');
    expect(text).toContain('summary text');
    expect(text).toContain('turn content');
    expect(text).toContain('edge warning');
  });

  /**
   * The point of the whole structured path: a reader sees the resources, not the N-labels that
   * only mean something to someone holding the brief.
   */
  it('renders a hop with the graph’s node names, its verdict and its technique', () => {
    const fixture = render(() => of({ ...response, transcript: [structuredTurn()] }));

    fixture.componentInstance.run();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('iam_role:api-task-role');
    expect(text).toContain('s3:customer-data-bucket');
    expect(text).toContain('can-access');
    expect(text).toContain('T1078');
    expect(text).toContain('confirmed');
    expect(text).toContain('F4 grants s3:GetObject');
  });

  /**
   * A hop with no matching graph edge is the one case where the product could be showing an
   * invented finding, so it has to be visible without opening anything.
   */
  it('warns on the face of a hop the resource graph does not back', () => {
    const fixture = render(() =>
      of({ ...response, transcript: [structuredTurn({ graphStatus: 'reversed' })] }),
    );

    fixture.componentInstance.run();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'runs the other way',
    );
  });

  /** Blue saying nothing about a hop must never read as Blue approving it. */
  it('shows an unattributed hop as having no verdict, not as confirmed', () => {
    const fixture = render(() =>
      of({ ...response, transcript: [structuredTurn({ verdict: 'Unattributed' })] }),
    );

    fixture.componentInstance.run();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('no verdict');
    expect(text).not.toContain('confirmed');
  });

  it('spells out what Blue’s closing verdict means', () => {
    const fixture = render(() =>
      of({ ...response, transcript: [structuredTurn({}, 'CHAIN_BROKEN')] }),
    );

    fixture.componentInstance.run();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'a link is refuted',
    );
  });

  /**
   * A deployed API that predates `display`, and a turn nothing could be read out of, are the
   * same case here: the raw text is all there is, and it must still be shown.
   */
  it('falls back to the raw turn text when there is no structured reading', () => {
    const empty = { headline: null, hops: [], facts: [], notes: [], verdict: null, isEmpty: true };
    const fixture = render(() =>
      of({
        ...response,
        transcript: [{ ...structuredTurn(), content: 'unparseable prose', display: empty }],
      }),
    );

    fixture.componentInstance.run();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('unparseable prose');
  });

  it('reports a failed run rather than hanging on "Running…"', () => {
    const fixture = render(() => throwError(() => new HttpErrorResponse({ status: 500 })));

    fixture.componentInstance.run();

    expect(fixture.componentInstance.running()).toBe(false);
    expect(fixture.componentInstance.error()).toContain('failed');
  });

  it('does not start a second run while one is already in flight', () => {
    const run = vi.fn(() => of(response));
    const fixture = render(run);

    fixture.componentInstance.running.set(true);
    fixture.componentInstance.run();

    expect(run).not.toHaveBeenCalled();
  });
});
