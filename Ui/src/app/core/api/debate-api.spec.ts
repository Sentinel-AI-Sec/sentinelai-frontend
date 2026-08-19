import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../config/environment';
import { DebateApi } from './debate-api';

/**
 * `DebateController` predates the `Response` envelope entirely — `Ok(DebateResponse.From(...))`
 * is returned bare, the one write endpoint in `core/api` that isn't wrapped. Pinned here for the
 * same reason the envelope IS pinned everywhere else: the difference is easy to get backwards by
 * analogy with `ScanOpsApi`, and getting it backwards fails as an undefined field, not an error.
 */
describe('DebateApi against the real wire shape', () => {
  let api: DebateApi;
  let http: HttpTestingController;
  const wasDemo = environment.useDemoData;

  beforeEach(() => {
    environment.useDemoData = false;

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    api = TestBed.inject(DebateApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useDemoData = wasDemo;
    http.verify();
  });

  const bareResponse = {
    scanJobId: 's1',
    outcome: 'ChainConfirmed',
    weakestJoin: 'Inferred',
    rounds: 2,
    turns: 4,
    terminatedByTurnCap: false,
    summary: 'summary',
    transcript: [],
    disclaimer: 'draft only',
    edgeIntegrityWarnings: [],
    abandonedReasoningWarnings: [],
    cost: {
      currency: 'USD',
      total: 0.1,
      modelCalls: 4,
      totalTokens: 100,
      rated: true,
      measured: true,
      byTier: [],
    },
  };

  it('reads the response bare, not through the Response envelope', async () => {
    const promise = firstValueFrom(api.run('s1', 'graph text'));

    const request = http.expectOne('/v1/debates');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ scanJobId: 's1', resourceGraph: 'graph text' });

    request.flush(bareResponse);

    expect((await promise).outcome).toBe('ChainConfirmed');
  });

  it('sends null for omitted scanJobId/resourceGraph, not undefined or empty string', () => {
    api.run().subscribe();

    const request = http.expectOne('/v1/debates');
    expect(request.request.body).toEqual({ scanJobId: null, resourceGraph: null });
    request.flush(bareResponse);
  });

  it('runs the demo fixture with an empty body against the /demo route', () => {
    api.runDemo().subscribe();

    const request = http.expectOne('/v1/debates/demo');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush(bareResponse);
  });

  it('returns a canned transcript with no request in demo mode', async () => {
    environment.useDemoData = true;

    const response = await firstValueFrom(api.runDemo());

    expect(response.transcript.length).toBeGreaterThan(0);
    expect(response.scanJobId).toBe('demo-scan');
    http.expectNone('/v1/debates/demo');
  });

  it('uses the given scanJobId for the demo response in demo mode run()', async () => {
    environment.useDemoData = true;

    const response = await firstValueFrom(api.run('my-scan'));

    expect(response.scanJobId).toBe('my-scan');
    http.expectNone('/v1/debates');
  });
});
