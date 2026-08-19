import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../config/environment';
import { BundleMetadataInput, ScanOpsApi } from './scan-ops-api';

/**
 * Pins the write side of the scan pipeline's actual wire behaviour — every one of these DTOs
 * rides inside the `Response` envelope (unlike `DebateApi`), and `RunAuditStageResponse` is
 * snake_case *inside* that envelope while its sibling `RunGraphStageResponse` is camelCase. Both
 * facts were found by reading the backend, not guessed, so they are pinned here the same way
 * `scan-api.spec.ts` pins the read side.
 */
describe('ScanOpsApi against the real wire shapes', () => {
  let api: ScanOpsApi;
  let http: HttpTestingController;
  const wasDemo = environment.useDemoData;

  beforeEach(() => {
    environment.useDemoData = false;

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    api = TestBed.inject(ScanOpsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useDemoData = wasDemo;
    http.verify();
  });

  const metadata: BundleMetadataInput = {
    project_id: 'proj-1',
    pr_ref: 'refs/pull/42/merge',
    commit_sha: 'abc123',
    model_tier_hint: 'auto',
    retain_report: true,
    runner_secret_scan: 'skipped',
    scanner_versions: { 'osv-scanner': '2.3.8' },
    artifacts: [],
  };

  it('submits the bundle as multipart with a JSON metadata part, and unwraps the envelope', async () => {
    const bundle = new File(['content'], 'bundle.tar.gz');
    const promise = firstValueFrom(api.submit(metadata, bundle));

    const request = http.expectOne('/v1/scans');
    expect(request.request.method).toBe('POST');

    const body = request.request.body as FormData;
    expect(body instanceof FormData).toBe(true);
    expect(JSON.parse(body.get('metadata') as string)).toEqual(metadata);
    expect((body.get('bundle') as File).name).toBe('bundle.tar.gz');

    request.flush({
      statusCode: 202,
      isSuccess: true,
      message: 'accepted',
      data: {
        scanJobId: 's1',
        status: 0,
        corpusVersion: '2026-07-15',
        pollUrl: '/v1/scans/s1',
        bundleSha256: 'sha',
        createdAt: '2026-08-16T09:00:00Z',
      },
    });

    expect((await promise).scanJobId).toBe('s1');
  });

  it('runs the graph stage with an empty body and unwraps the camelCase response', async () => {
    const promise = firstValueFrom(api.runGraphStage('s1'));

    const request = http.expectOne('/v1/scans/s1/graph');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});

    request.flush({
      statusCode: 200,
      isSuccess: true,
      message: 'graph stage complete',
      data: {
        scanJobId: 's1',
        findings: 3,
        messagesRedacted: 0,
        hardcodedSecrets: 0,
        terraformFiles: 1,
        lockFiles: 1,
        dockerfiles: 0,
        candidateChains: 1,
        chains: [],
        nodes: [],
        edges: [],
        resourceGraph: 'graph text',
        disclaimer: 'Candidate chains only.',
      },
    });

    const result = await promise;
    expect(result.candidateChains).toBe(1);
    expect(result.resourceGraph).toBe('graph text');
  });

  it('runs the audit stage and unwraps its snake_case fields from inside the envelope', async () => {
    // The one inconsistency in this file: RunAuditStageResponse carries [JsonPropertyName]
    // attributes even though it is still wrapped. A camelCase read here would leave every field
    // undefined without ever failing loudly.
    const promise = firstValueFrom(api.runAuditStage('s1'));

    const request = http.expectOne('/v1/scans/s1/audit');
    expect(request.request.method).toBe('POST');

    request.flush({
      statusCode: 200,
      isSuccess: true,
      message: 'audit stage complete',
      data: {
        scan_job_id: 's1',
        report_id: 'r1',
        report_retained: true,
        bundle_purged: true,
        framing: 'draft_audit',
        summary: 'summary',
        outcome: 'ChainConfirmed',
        rounds: 3,
        citations: 4,
      },
    });

    const result = await promise;
    expect(result.report_id).toBe('r1');
    expect(result.report_retained).toBe(true);
  });

  it('purges the bundle and unwraps the same ScanJobResponse shape GET /v1/scans/{id} returns', async () => {
    const promise = firstValueFrom(api.purge('s1'));

    const request = http.expectOne('/v1/scans/s1/purge');
    expect(request.request.method).toBe('POST');

    request.flush({
      statusCode: 200,
      isSuccess: true,
      message: 'bundle purged',
      data: {
        scanJobId: 's1',
        status: 2,
        stage: 5,
        corpusVersion: '2026-07-15',
        bundlePurged: true,
        failureReason: null,
        startedAt: '2026-08-16T09:00:00Z',
        completedAt: '2026-08-16T09:14:00Z',
      },
    });

    expect((await promise).bundlePurged).toBe(true);
  });

  it('issues no requests for any write in demo mode', async () => {
    environment.useDemoData = true;

    await firstValueFrom(api.submit(metadata, new File(['x'], 'b.tar.gz')));
    await firstValueFrom(api.runGraphStage('demo-scan'));
    await firstValueFrom(api.runAuditStage('demo-scan'));
    await firstValueFrom(api.purge('demo-scan'));

    http.expectNone('/v1/scans');
    http.expectNone('/v1/scans/demo-scan/graph');
    http.expectNone('/v1/scans/demo-scan/audit');
    http.expectNone('/v1/scans/demo-scan/purge');
  });
});
