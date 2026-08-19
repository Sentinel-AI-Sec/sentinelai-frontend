import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of } from 'rxjs';

import { environment } from '../config/environment';
import { demoReport } from './demo-data';
import { ResponseEnvelope, ScanJobResponse } from './wire';

/**
 * The write half of the scan pipeline (`ScanController`'s non-SEC-40 endpoints) — submitting a
 * bundle and manually driving it through the stages a queue-driven worker will eventually run.
 *
 * Every type here is transcribed straight from the C# records that produce it, the same
 * discipline `wire.ts` documents for the read side. None of these DTOs carry
 * `[JsonPropertyName]` attributes, so — like `ScanJobResponse` — they serialize camelCase, and
 * every response here rides inside the `Response` envelope (`statusCode`/`isSuccess`/`data`/
 * `message`) rather than bare, because these handlers return `Response` through
 * `StatusCode((int)response.StatusCode, response)` rather than the SEC-40 `Render` helper.
 */

/** The `metadata.json` multipart part, exactly as `BundleMetadata.cs` defines it (snake_case). */
export interface BundleMetadataInput {
  project_id: string;
  pr_ref: string;
  commit_sha: string;
  model_tier_hint: 'auto' | 'economy' | 'premium';
  retain_report: boolean;
  runner_secret_scan: string;
  /** Free-form; stored verbatim as provenance. An object, not a string — sent as real JSON. */
  scanner_versions: Record<string, unknown>;
  artifacts: BundleArtifactInput[];
}

/** kind: sarif | dot | tf | dockerfile | manifest | provenance | other. */
export interface BundleArtifactInput {
  kind: string;
  /** tool: checkov | trivy | osv-scanner | roslyn-security | terraform | docker | nuget | npm | sentinelai. */
  tool: string;
  filename: string;
}

/** `POST /v1/scans` response (`SubmitScanResponse.cs`). */
export interface SubmitScanResponse {
  scanJobId: string;
  /** Numeric `ScanStatus` — 0 queued, 1 running, 2 completed, 3 failed. */
  status: number;
  corpusVersion: string;
  /** Where to `GET` this job's status — `/v1/scans/{id}`. */
  pollUrl: string;
  bundleSha256: string;
  createdAt: string;
}

/** One node of the graph the `graph` stage persisted (`NodeView` in `RunGraphStageCommandHandler.cs`). */
export interface GraphStageNode {
  key: string;
  type: string;
  layer: string;
  hot: boolean;
}

/** One edge, addressed by node key rather than row id (`EdgeView`). */
export interface GraphStageEdge {
  from: string;
  relation: string;
  to: string;
  confidence: string;
}

/** One hop of a candidate chain (`HopView`). `relation`/`confidence` are null on the seed hop. */
export interface GraphStageHop {
  order: number;
  nodeKey: string;
  layer: string;
  tactic: string;
  relation: string | null;
  confidence: string | null;
  findings: string[];
}

/** One candidate chain the graph stage generated deterministically from real edges (`ChainView`). */
export interface GraphStageChain {
  priority: number;
  hopCount: number;
  minConfidence: string;
  maxSeverity: number;
  path: string[];
  hops: GraphStageHop[];
}

/** `POST /v1/scans/{id}/graph` response (`RunGraphStageResponse.cs`). */
export interface RunGraphStageResponse {
  scanJobId: string;
  findings: number;
  messagesRedacted: number;
  hardcodedSecrets: number;
  terraformFiles: number;
  lockFiles: number;
  dockerfiles: number;
  candidateChains: number;
  chains: GraphStageChain[];
  nodes: GraphStageNode[];
  edges: GraphStageEdge[];
  /** The resource graph exactly as rendered for the agents — pasteable into a debate run. */
  resourceGraph: string;
  disclaimer: string;
}

/**
 * `POST /v1/scans/{id}/audit` response (`RunAuditStageResponse.cs`).
 *
 * snake_case, unlike every other type in this file — this one DOES carry `[JsonPropertyName]`
 * attributes, deliberately written in the SEC-40 read API's wire style even though it still
 * rides inside the `Response` envelope. Not a typo; transcribed as the backend actually sends it.
 */
export interface RunAuditStageResponse {
  scan_job_id: string;
  /** Null when the report was not retained — nothing to fetch from `GET /v1/reports/{id}`. */
  report_id: string | null;
  report_retained: boolean;
  bundle_purged: boolean;
  framing: string;
  summary: string;
  outcome: string;
  rounds: number;
  citations: number;
}

@Injectable({ providedIn: 'root' })
export class ScanOpsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /**
   * Submits a bundle for scanning: a `metadata` text part (JSON, matching
   * {@link BundleMetadataInput}) plus a `bundle` file part (`.tar.gz`, max 64 MB). Requires the
   * `scan:write` scope.
   */
  submit(metadata: BundleMetadataInput, bundle: File): Observable<SubmitScanResponse> {
    if (environment.useDemoData) {
      return this.demo({
        scanJobId: 'demo-scan',
        status: 0,
        corpusVersion: demoReport.corpus_version,
        pollUrl: '/v1/scans/demo-scan',
        bundleSha256: 'e3b0c44298fc1c149afbf4c8996fb924',
        createdAt: new Date().toISOString(),
      });
    }

    const form = new FormData();
    form.append('metadata', JSON.stringify(metadata));
    form.append('bundle', bundle, bundle.name);

    return this.http
      .post<ResponseEnvelope<SubmitScanResponse>>(`${this.base}/v1/scans`, form)
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Runs normalize → graph → candidate-chain generation over an already-ingested bundle.
   * Requires `scan:write` — it writes graph, node and chain rows.
   */
  runGraphStage(scanJobId: string): Observable<RunGraphStageResponse> {
    if (environment.useDemoData) {
      // Deliberately low-fidelity: demo mode exists so the screen has something to render
      // without a backend, not to reproduce the graph stage's full output — that's what running
      // it against a real scan job is for.
      return this.demo({
        scanJobId,
        findings: 6,
        messagesRedacted: 1,
        hardcodedSecrets: 1,
        terraformFiles: 2,
        lockFiles: 1,
        dockerfiles: 1,
        candidateChains: 3,
        chains: [],
        nodes: [],
        edges: [],
        resourceGraph: '(demo mode — run this against a real scan job to see the rendered graph)',
        disclaimer:
          'Candidate chains only: deterministically generated from real graph edges. ' +
          'Nothing here is an asserted or validated attack path — that is the debate’s job.',
      });
    }

    return this.http
      .post<ResponseEnvelope<RunGraphStageResponse>>(`${this.base}/v1/scans/${scanJobId}/graph`, {})
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Runs retrieve → debate → report → retention over a job whose graph stage has already run.
   * Requires `scan:write` — it writes a report and purges the bundle.
   */
  runAuditStage(scanJobId: string): Observable<RunAuditStageResponse> {
    if (environment.useDemoData) {
      return this.demo({
        scan_job_id: scanJobId,
        report_id: demoReport.report_id,
        report_retained: true,
        bundle_purged: true,
        framing: demoReport.framing,
        summary: demoReport.summary,
        outcome: 'chain_confirmed',
        rounds: 3,
        citations: demoReport.citations.length,
      });
    }

    return this.http
      .post<ResponseEnvelope<RunAuditStageResponse>>(`${this.base}/v1/scans/${scanJobId}/audit`, {})
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Administratively purges a job's stored bundle ahead of retention. Admin role only — this
   * deletes an artifact, not just reads one. Returns the job in its SEC-40 read shape (reused
   * from `wire.ts` — same `ScanJobResponse` `GET /v1/scans/{id}` returns).
   */
  purge(scanJobId: string): Observable<ScanJobResponse> {
    if (environment.useDemoData) {
      return this.demo({
        scanJobId,
        status: 2,
        stage: 5,
        corpusVersion: demoReport.corpus_version,
        bundlePurged: true,
        failureReason: null,
        startedAt: demoReport.created_at,
        completedAt: demoReport.created_at,
      });
    }

    return this.http
      .post<ResponseEnvelope<ScanJobResponse>>(`${this.base}/v1/scans/${scanJobId}/purge`, {})
      .pipe(map((envelope) => envelope.data));
  }

  /** A visible pause, so loading states are exercised in demo mode rather than never seen. */
  private demo<T>(value: T): Observable<T> {
    return of(value).pipe(delay(250));
  }
}
