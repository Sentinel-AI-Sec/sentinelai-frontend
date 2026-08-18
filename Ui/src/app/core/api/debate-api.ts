import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, of } from 'rxjs';

import { environment } from '../config/environment';

/**
 * The Red/Blue/Reporter debate, run synchronously over HTTP (`DebateController`).
 *
 * Unlike every other write endpoint in `core/api`, this one is NOT wrapped in the `Response`
 * envelope — `DebateController` hands back `Ok(DebateResponse.From(...))` directly, bare, the
 * same as the SEC-40 read endpoints but for a different reason (this predates that convention
 * entirely; SEC-02 wired the agent stack up before SEC-40 existed).
 *
 * A live run is 4–7 sequential model calls — 90–140s measured against NIM — so this is a
 * dev/ops exercise surface, not part of the product's real pipeline (that runs `POST
 * /v1/scans/{id}/audit`, which enqueues the same debate but does not block a request thread on
 * it... today it still does, synchronously, until a worker replaces it — see that command's own
 * remarks). A caller here should expect the request to sit open for over a minute.
 */

export interface DebateTurnView {
  role: string;
  round: number;
  confidence: string;
  /** Which tier the turn was routed to — High or Cheap. */
  tier: string;
  tokens: number;
  content: string;
}

export interface DebateTierView {
  tier: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  rated: boolean;
}

export interface DebateCostView {
  currency: string;
  total: number;
  modelCalls: number;
  totalTokens: number;
  /** True only if every call in the run had a known price. */
  rated: boolean;
  /** True if the provider reported real token usage (as opposed to nothing having run). */
  measured: boolean;
  byTier: DebateTierView[];
}

export interface DebateResponse {
  scanJobId: string;
  outcome: string;
  weakestJoin: string;
  rounds: number;
  turns: number;
  terminatedByTurnCap: boolean;
  summary: string;
  transcript: DebateTurnView[];
  disclaimer: string;
  /** SEC-50: hops in the Reporter's own chain that don't match a real graph edge. Empty is clean. */
  edgeIntegrityWarnings: string[];
  /** SEC-50: hops Red/Blue raised but the Reporter didn't carry into the final chain. */
  abandonedReasoningWarnings: string[];
  cost: DebateCostView;
}

@Injectable({ providedIn: 'root' })
export class DebateApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /**
   * Runs the debate over a supplied resource graph (paste one from a `runGraphStage` response's
   * `resourceGraph` field), or the built-in AID-01 fixture if `resourceGraph` is omitted.
   */
  run(scanJobId?: string, resourceGraph?: string): Observable<DebateResponse> {
    if (environment.useDemoData) return this.demoResponse(scanJobId || 'api-scan');

    return this.http.post<DebateResponse>(`${this.base}/v1/debates`, {
      scanJobId: scanJobId || null,
      resourceGraph: resourceGraph || null,
    });
  }

  /** Runs the debate against the built-in AID-01 fixture. No body required. */
  runDemo(): Observable<DebateResponse> {
    if (environment.useDemoData) return this.demoResponse('demo-scan');

    return this.http.post<DebateResponse>(`${this.base}/v1/debates/demo`, {});
  }

  /**
   * A canned transcript so this screen is explorable without waiting on 4–7 real model calls.
   * Not a fixture the backend ships (unlike `demo-data.ts`'s report, which mirrors a real
   * endpoint's shape) — this stands in for a call the demo mode has no equivalent live version
   * of, so it is written by hand to look like one.
   */
  private demoResponse(scanJobId: string): Observable<DebateResponse> {
    const response: DebateResponse = {
      scanJobId,
      outcome: 'ChainConfirmed',
      weakestJoin: 'Inferred',
      rounds: 2,
      turns: 4,
      terminatedByTurnCap: false,
      summary:
        'Red proposed a path from the vulnerable dependency through the task role to the ' +
        'customer-data bucket; Blue validated every hop except the image-to-task join, which ' +
        'rests on a naming convention rather than a digest.',
      transcript: [
        {
          role: 'Orchestrator',
          round: 1,
          confidence: 'Certain',
          tier: 'Cheap',
          tokens: 210,
          content: 'Briefing: one dependency finding, one code finding, two infra findings. Begin.',
        },
        {
          role: 'Red',
          round: 1,
          confidence: 'Inferred',
          tier: 'High',
          tokens: 640,
          content:
            'The vulnerable deserialization in OrdersController is reachable from the ' +
            'newtonsoft.json CVE and lands in a task assuming a wildcard S3 role.',
        },
        {
          role: 'Blue',
          round: 1,
          confidence: 'Inferred',
          tier: 'High',
          tokens: 585,
          content:
            'Agreed on the code and infra joins. The image-to-task join is a name match, not a ' +
            'digest — demoting this chain to inferred rather than certain.',
        },
        {
          role: 'Reporter',
          round: 2,
          confidence: 'Inferred',
          tier: 'High',
          tokens: 410,
          content: 'Reporting one chain, inferred confidence, priority 1. See summary.',
        },
      ],
      disclaimer:
        'Draft audit only: this is a candidate exploit chain that exists in the resource graph, ' +
        'not a proven or executed attack.',
      edgeIntegrityWarnings: [],
      abandonedReasoningWarnings: [],
      cost: {
        currency: 'USD',
        total: 0.31,
        modelCalls: 4,
        totalTokens: 1845,
        rated: true,
        measured: true,
        byTier: [
          { tier: 'Cheap', calls: 1, inputTokens: 140, outputTokens: 70, cost: 0.01, rated: true },
          { tier: 'High', calls: 3, inputTokens: 980, outputTokens: 655, cost: 0.3, rated: true },
        ],
      },
    };

    return of(response).pipe(delay(400));
  }
}
