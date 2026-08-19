import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DebateApi, DebateResponse } from '../../core/api/debate-api';
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
