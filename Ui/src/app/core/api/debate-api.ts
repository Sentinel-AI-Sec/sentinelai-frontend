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

/**
 * One hop of a chain, as the backend read it out of an agent's turn.
 *
 * Every field here is either quoted from the turn or checked against the resource graph the
 * agent was given — none of it is inferred, and the parsing that produced it lives in
 * `TurnPresenter` on the server rather than here. Re-deriving it in the browser would mean two
 * parsers disagreeing about what an agent said, and the screen contradicting the database.
 */
export interface DebateHopView {
  /** 1-based position within the turn. */
  order: number;
  /** The `N<n>` label the agent wrote. */
  from: string;
  to: string;
  /** The graph's own name for the node — never the agent's inline claim about it. */
  fromLabel: string | null;
  toLabel: string | null;
  relation: string | null;
  /** An ATT&CK id, kept only where the brief itself named it. */
  technique: string | null;
  /**
   * Blue's judgement: `Confirmed`, `Unresolved`, `Refuted` — or `Unattributed`, which means
   * Blue said nothing this hop can be held to. `Unattributed` is NOT a pass and must never be
   * rendered as one.
   */
  verdict: string;
  /**
   * The deterministic edge check: `confirmed`, `reversed`, `unrecognized`, or `unchecked`.
   * The one field on a hop that is not a model's word.
   */
  graphStatus: string;
  evidence: string | null;
  /** The whole line as written, so the reading above can be checked against it. */
  text: string;
}

/** A labelled line an agent wrote — `SEVERITY: high` arrives as label + value. */
export interface DebateFactView {
  label: string;
  value: string;
}

/**
 * A turn taken apart into what it claimed.
 *
 * `isEmpty` is the case that matters: a model that ignored its instructions produces prose
 * nothing can be read out of, and the turn is then rendered as plain text instead.
 */
export interface DebateDisplayView {
  headline: string | null;
  hops: DebateHopView[];
  facts: DebateFactView[];
  notes: string[];
  /** Blue only: `CHAIN_HOLDS`, `CHAIN_BROKEN`, or `UNREADABLE`. Null for the other three. */
  verdict: string | null;
  isEmpty: boolean;
}

export interface DebateTurnView {
  role: string;
  round: number;
  confidence: string;
  /** Which tier the turn was routed to — High or Cheap. */
  tier: string;
  tokens: number;
  content: string;
  /**
   * The structured reading of `content`. Optional on the wire only because a deployed API may
   * predate it — treat a missing value the same as an empty one and fall back to `content`.
   */
  display?: DebateDisplayView;
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
   *
   * Written against the AID-01 stub graph's own node labels, and carrying the same `display`
   * structure the server computes, so demo mode exercises the real rendering path rather than a
   * simplified one. The turns deliberately cover the cases worth seeing: a hop Blue left
   * UNRESOLVED, a hop it never judged, and a technique the brief did not ground.
   */
  private demoResponse(scanJobId: string): Observable<DebateResponse> {
    const response: DebateResponse = {
      scanJobId,
      outcome: 'ChainConfirmed',
      weakestJoin: 'Unresolved',
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
          round: 0,
          confidence: 'Certain',
          tier: 'Cheap',
          tokens: 210,
          content: [
            'TARGET: N8, the customer-data-bucket holding customer PII.',
            'LEAD: F1 — commons-collections 3.2.1 (CVE-2015-6420, CVSS 9.8).',
            'ROUTE: dependency to application code to the running task to its IAM role.',
            'WEAK JOIN: N2 -> N4, joined by image tag rather than digest.',
          ].join('\n'),
          display: {
            headline: null,
            hops: [],
            facts: [
              { label: 'TARGET', value: 'N8, the customer-data-bucket holding customer PII.' },
              { label: 'LEAD', value: 'F1 — commons-collections 3.2.1 (CVE-2015-6420, CVSS 9.8).' },
              {
                label: 'ROUTE',
                value: 'dependency to application code to the running task to its IAM role.',
              },
              { label: 'WEAK JOIN', value: 'N2 -> N4, joined by image tag rather than digest.' },
            ],
            notes: [],
            verdict: null,
            isEmpty: false,
          },
        },
        {
          role: 'Red',
          round: 1,
          confidence: 'Certain',
          tier: 'High',
          tokens: 640,
          content: [
            'HOP 1: N1 -> used-by -> N2 | none | F1: the lock file pins 3.2.1 and the handler imports InvokerTransformer',
            'HOP 2: N2 -> deployed-as -> N4 | none | the api-service task definition references acme/api by tag',
            'HOP 3: N4 -> assumes -> N6 | none | taskRoleArn names api-task-role',
            'HOP 4: N6 -> can-access -> N8 | none | F4: the inline policy grants s3:GetObject',
            'CHAIN: N1 -> N2 -> N4 -> N6 -> N8',
            'IMPACT: unauthenticated deserialization ends in read/write access to customer PII.',
          ].join('\n'),
          display: {
            headline: null,
            hops: [
              {
                order: 1,
                from: 'N1',
                to: 'N2',
                fromLabel: 'pkg:commons-collections:3.2.1',
                toLabel: 'code:appdatahandler.deserialize()',
                relation: 'used-by',
                technique: null,
                verdict: 'Unattributed',
                graphStatus: 'confirmed',
                evidence: 'F1: the lock file pins 3.2.1 and the handler imports InvokerTransformer',
                text: 'HOP 1: N1 -> used-by -> N2 | none | F1: the lock file pins 3.2.1 and the handler imports InvokerTransformer',
              },
              {
                order: 2,
                from: 'N2',
                to: 'N4',
                fromLabel: 'code:appdatahandler.deserialize()',
                toLabel: 'task:ecs-task/api-service',
                relation: 'deployed-as',
                technique: null,
                verdict: 'Unattributed',
                graphStatus: 'confirmed',
                evidence: 'the api-service task definition references acme/api by tag',
                text: 'HOP 2: N2 -> deployed-as -> N4 | none | the api-service task definition references acme/api by tag',
              },
              {
                order: 3,
                from: 'N4',
                to: 'N6',
                fromLabel: 'task:ecs-task/api-service',
                toLabel: 'iam_role:api-task-role',
                relation: 'assumes',
                technique: null,
                verdict: 'Unattributed',
                graphStatus: 'confirmed',
                evidence: 'taskRoleArn names api-task-role',
                text: 'HOP 3: N4 -> assumes -> N6 | none | taskRoleArn names api-task-role',
              },
              {
                order: 4,
                from: 'N6',
                to: 'N8',
                fromLabel: 'iam_role:api-task-role',
                toLabel: 's3:customer-data-bucket',
                relation: 'can-access',
                technique: null,
                verdict: 'Unattributed',
                graphStatus: 'confirmed',
                evidence: 'F4: the inline policy grants s3:GetObject',
                text: 'HOP 4: N6 -> can-access -> N8 | none | F4: the inline policy grants s3:GetObject',
              },
            ],
            facts: [
              { label: 'CHAIN', value: 'N1 -> N2 -> N4 -> N6 -> N8' },
              {
                label: 'IMPACT',
                value: 'unauthenticated deserialization ends in read/write access to customer PII.',
              },
            ],
            notes: [],
            verdict: null,
            isEmpty: false,
          },
        },
        {
          role: 'Blue',
          round: 1,
          confidence: 'Unresolved',
          tier: 'High',
          tokens: 585,
          content: [
            'HOP 1: N1 -> N2 | CONFIRMED | the lock file and the import in F1 both name the gadget class',
            'HOP 2: N2 -> N4 | UNRESOLVED | U1: the image is joined by mutable tag, not by digest',
            'HOP 3: N4 -> N6 | CONFIRMED | the task definition names api-task-role outright',
            'HOP 4: N6 -> N8 | CONFIRMED | F4 grants s3:Get/PutObject on customer-data-bucket/*',
            'VERDICT: CHAIN_HOLDS',
          ].join('\n'),
          display: {
            headline: null,
            hops: [
              {
                order: 1,
                from: 'N1',
                to: 'N2',
                fromLabel: 'pkg:commons-collections:3.2.1',
                toLabel: 'code:appdatahandler.deserialize()',
                relation: null,
                technique: null,
                verdict: 'Confirmed',
                graphStatus: 'confirmed',
                evidence: 'the lock file and the import in F1 both name the gadget class',
                text: 'HOP 1: N1 -> N2 | CONFIRMED | the lock file and the import in F1 both name the gadget class',
              },
              {
                order: 2,
                from: 'N2',
                to: 'N4',
                fromLabel: 'code:appdatahandler.deserialize()',
                toLabel: 'task:ecs-task/api-service',
                relation: null,
                technique: null,
                verdict: 'Unresolved',
                graphStatus: 'confirmed',
                evidence: 'U1: the image is joined by mutable tag, not by digest',
                text: 'HOP 2: N2 -> N4 | UNRESOLVED | U1: the image is joined by mutable tag, not by digest',
              },
              {
                order: 3,
                from: 'N4',
                to: 'N6',
                fromLabel: 'task:ecs-task/api-service',
                toLabel: 'iam_role:api-task-role',
                relation: null,
                technique: null,
                verdict: 'Confirmed',
                graphStatus: 'confirmed',
                evidence: 'the task definition names api-task-role outright',
                text: 'HOP 3: N4 -> N6 | CONFIRMED | the task definition names api-task-role outright',
              },
              {
                order: 4,
                from: 'N6',
                to: 'N8',
                fromLabel: 'iam_role:api-task-role',
                toLabel: 's3:customer-data-bucket',
                relation: null,
                technique: null,
                verdict: 'Confirmed',
                graphStatus: 'confirmed',
                evidence: 'F4 grants s3:Get/PutObject on customer-data-bucket/*',
                text: 'HOP 4: N6 -> N8 | CONFIRMED | F4 grants s3:Get/PutObject on customer-data-bucket/*',
              },
            ],
            facts: [],
            notes: [],
            verdict: 'CHAIN_HOLDS',
            isEmpty: false,
          },
        },
        {
          role: 'Reporter',
          round: 2,
          confidence: 'Unresolved',
          tier: 'High',
          tokens: 410,
          content: [
            'CHAIN: N1 -> N2 -> N4 -> N6 -> N8',
            'SEVERITY: high — a CVSS 9.8 gadget chain ends at the crown jewel',
            'CONFIDENCE: unresolved — the weakest join is N2 -> N4',
            'IMPACT: an attacker reaching the deserialization sink can read and write customer PII.',
            'EVIDENCE: F1 for the gadget chain, F4 for the bucket grant, U1 for the image join',
            'NEXT: record the deployed image digest and compare it against the task definition.',
          ].join('\n'),
          display: {
            headline: null,
            hops: [],
            facts: [
              { label: 'CHAIN', value: 'N1 -> N2 -> N4 -> N6 -> N8' },
              { label: 'SEVERITY', value: 'high — a CVSS 9.8 gadget chain ends at the crown jewel' },
              { label: 'CONFIDENCE', value: 'unresolved — the weakest join is N2 -> N4' },
              {
                label: 'IMPACT',
                value:
                  'an attacker reaching the deserialization sink can read and write customer PII.',
              },
              {
                label: 'EVIDENCE',
                value: 'F1 for the gadget chain, F4 for the bucket grant, U1 for the image join',
              },
              {
                label: 'NEXT',
                value: 'record the deployed image digest and compare it against the task definition.',
              },
            ],
            notes: [],
            verdict: null,
            isEmpty: false,
          },
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
