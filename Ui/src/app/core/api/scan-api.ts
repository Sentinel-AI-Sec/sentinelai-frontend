import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of } from 'rxjs';

import { environment } from '../config/environment';
import { demoFindings, demoGraph, demoReport } from './demo-data';
import {
  BundleProvenance,
  Chain,
  Finding,
  Page,
  Report,
  ResourceGraph,
  ResponseEnvelope,
  ScanJobResponse,
  ScanListItem,
} from './wire';

/**
 * Every call the screen makes to the read API (SEC-40).
 *
 * The screen is a read-only surface: there is deliberately no method here that starts a scan,
 * runs a stage, or purges anything. All reasoning happens in the backend — a UI that could
 * trigger analysis is a UI that will eventually be asked to interpret it too.
 *
 * When `environment.useDemoData` is set the same methods return the reference fixture's audit
 * instead of issuing a request. The demo path returns the identical wire types, so a component
 * cannot behave differently depending on where its data came from.
 */
@Injectable({ providedIn: 'root' })
export class ScanApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** A visible pause, so loading states are exercised in demo mode rather than never seen. */
  private static readonly DemoLatencyMs = 250;

  /**
   * Poll one scan job.
   *
   * The only call here that has to unwrap an envelope. This endpoint predates SEC-40 and was
   * never converted, so it returns `Response` whole while every read below returns its payload
   * bare — see {@link ScanJobResponse}. Unwrapping it here rather than at the caller keeps that
   * oddity in one place.
   */
  getScanJob(scanJobId: string): Observable<ScanJobResponse> {
    if (environment.useDemoData) {
      return this.demo({
        scanJobId,
        status: 2, // completed
        stage: 5, // report
        corpusVersion: demoReport.corpus_version,
        bundlePurged: true,
        failureReason: null,
        startedAt: demoReport.created_at,
        completedAt: demoReport.created_at,
      });
    }

    return this.http
      .get<ResponseEnvelope<ScanJobResponse>>(`${this.base}/v1/scans/${scanJobId}`)
      .pipe(map((envelope) => envelope.data));
  }

  getReport(reportId: string): Observable<Report> {
    if (environment.useDemoData) {
      return this.demo({ ...demoReport, report_id: reportId });
    }

    return this.http.get<Report>(`${this.base}/v1/reports/${reportId}`);
  }

  getBundle(scanJobId: string): Observable<BundleProvenance> {
    if (environment.useDemoData) {
      return this.demo({
        scan_job_id: scanJobId,
        runner_secret_scan: 'passed',
        ingress_redaction_applied: true,
        artifact_manifest: '[]',
        scanner_versions: '{"roslyn-security":"5.6.7","osv-scanner":"2.3.8"}',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb924',
        size_bytes: 48_213,
        received_at: demoReport.created_at,
        bundle_purged: true,
      });
    }

    return this.http.get<BundleProvenance>(`${this.base}/v1/scans/${scanJobId}/bundle`);
  }

  /**
   * A page of findings, optionally filtered.
   *
   * `min_severity` and `layer` are passed through as the API spells them, not renamed — the
   * query string is as much a contract as the response body.
   */
  getFindings(
    scanJobId: string,
    options: { cursor?: string; limit?: number; layer?: string; minSeverity?: number } = {},
  ): Observable<Page<Finding>> {
    if (environment.useDemoData) {
      const filtered = demoFindings.filter(
        (f) =>
          (options.layer ? f.layer === options.layer : true) &&
          (options.minSeverity != null ? f.severity >= options.minSeverity : true),
      );
      return this.demo({ items: filtered, next_cursor: null, limit: 50 });
    }

    let params = new HttpParams();
    if (options.cursor) params = params.set('cursor', options.cursor);
    if (options.limit != null) params = params.set('limit', options.limit);
    if (options.layer) params = params.set('layer', options.layer);
    if (options.minSeverity != null) params = params.set('min_severity', options.minSeverity);

    return this.http.get<Page<Finding>>(`${this.base}/v1/scans/${scanJobId}/findings`, { params });
  }

  /**
   * This tenant's scans, newest first, optionally narrowed by project or status.
   *
   * A server-side list rather than the browser's own record of what it has opened. Every scan is
   * started by CI, on somebody's push — so a local index would show a fraction of them, and
   * nothing at all on a machine the user has not used before.
   *
   * Cursor-paged with no total, because the read API exposes none. Callers must not derive a
   * count from a page.
   */
  listScans(
    options: { projectId?: string; status?: string; limit?: number; cursor?: string } = {},
  ): Observable<Page<ScanListItem>> {
    if (environment.useDemoData) {
      return this.demo({ items: [] as ScanListItem[], next_cursor: null, limit: 20 });
    }

    let params = new HttpParams();
    if (options.projectId) params = params.set('project_id', options.projectId);
    if (options.status) params = params.set('status', options.status);
    if (options.limit != null) params = params.set('limit', options.limit);
    if (options.cursor) params = params.set('cursor', options.cursor);

    return this.http.get<Page<ScanListItem>>(`${this.base}/v1/scans`, { params });
  }

  getChains(scanJobId: string, cursor?: string, limit?: number): Observable<Page<Chain>> {
    if (environment.useDemoData) {
      return this.demo({ items: demoReport.chains, next_cursor: null, limit: 50 });
    }

    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    if (limit != null) params = params.set('limit', limit);

    return this.http.get<Page<Chain>>(`${this.base}/v1/scans/${scanJobId}/chains`, { params });
  }

  getGraph(scanJobId: string): Observable<ResourceGraph> {
    if (environment.useDemoData) {
      // The fixture's own graph, not an empty one. An empty graph is a legitimate answer from
      // the real endpoint (the graph stage has not run yet) and the screen renders it as
      // exactly that — so returning it here would have demo mode permanently showing the
      // "nothing to draw" state for the one screen that is entirely a drawing.
      return this.demo({ ...demoGraph, scan_job_id: scanJobId });
    }

    return this.http.get<ResourceGraph>(`${this.base}/v1/scans/${scanJobId}/graph`);
  }

  private demo<T>(value: T): Observable<T> {
    return of(value).pipe(delay(ScanApi.DemoLatencyMs));
  }
}
