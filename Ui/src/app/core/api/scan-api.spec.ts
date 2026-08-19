import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../config/environment';
import { ScanApi } from './scan-api';

/**
 * Pins the read API's actual wire behaviour.
 *
 * These exist because the API is not uniform, and every difference below was found by reading
 * the backend rather than by guessing — after guessing wrong. The SEC-40 read endpoints unwrap
 * the `Response` envelope and use snake_case DTOs; `GET /v1/scans/{id}` predates them and does
 * neither. A future contributor who "tidies up" one of these to match the other will break the
 * screen in a way that shows up as blank fields, not as an error, so the difference is asserted
 * rather than described in a comment.
 */
describe('ScanApi against the real wire shapes', () => {
  let api: ScanApi;
  let http: HttpTestingController;
  const wasDemo = environment.useDemoData;

  beforeEach(() => {
    environment.useDemoData = false;

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    api = TestBed.inject(ScanApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useDemoData = wasDemo;
    http.verify();
  });

  it('reads a report as a bare payload, not an envelope', () => {
    // ReportController returns Ok(response.Data). Expecting an envelope here would leave every
    // field undefined and the page blank.
    let framing: string | undefined;
    api.getReport('r1').subscribe((report) => (framing = report.framing));

    http.expectOne('/v1/reports/r1').flush({
      report_id: 'r1',
      scan_job_id: 's1',
      framing: 'draft_audit',
      summary: '',
      corpus_version: '2026-07-15',
      created_at: '2026-08-16T09:14:22Z',
      retained: true,
      chains: [],
      citations: [],
      cost: { currency: 'USD', total: 0, model_calls: 0, rated: false },
    });

    expect(framing).toBe('draft_audit');
  });

  it('reads a findings page as items + next_cursor + limit', () => {
    let count = -1;
    let limit = -1;
    api.getFindings('s1').subscribe((page) => {
      count = page.items.length;
      limit = page.limit;
    });

    http
      .expectOne((r) => r.url === '/v1/scans/s1/findings')
      .flush({
        items: [
          {
            id: 'f1',
            source_tool: 'roslyn',
            layer: 'code',
            severity: 4,
            cwe_id: 'CWE-502',
            cve_id: null,
            node_ref: 'code:x',
            message: 'm',
            redacted: false,
          },
        ],
        next_cursor: null,
        limit: 50,
      });

    expect(count).toBe(1);
    expect(limit).toBe(50);
  });

  it('sends the filter names the API spells, not renamed ones', () => {
    // min_severity, not minSeverity. The query string is as much a contract as the body, and a
    // wrong name is ignored silently — the screen just shows unfiltered results.
    api.getFindings('s1', { layer: 'infra', minSeverity: 3, limit: 10 }).subscribe();

    const request = http.expectOne((r) => r.url === '/v1/scans/s1/findings');

    expect(request.request.params.get('layer')).toBe('infra');
    expect(request.request.params.get('min_severity')).toBe('3');
    expect(request.request.params.get('limit')).toBe('10');

    request.flush({ items: [], next_cursor: null, limit: 10 });
  });

  it('unwraps the envelope on the one endpoint that still returns one', () => {
    // GET /v1/scans/{id} predates SEC-40: envelope, camelCase, numeric enums.
    let stage = -1;
    api.getScanJob('s1').subscribe((job) => (stage = job.stage));

    http.expectOne('/v1/scans/s1').flush({
      statusCode: 200,
      isSuccess: true,
      message: 'ok',
      data: {
        scanJobId: 's1',
        status: 2,
        stage: 5,
        corpusVersion: '2026-07-15',
        bundlePurged: false,
        failureReason: null,
        startedAt: '2026-08-16T09:00:00Z',
        completedAt: '2026-08-16T09:14:00Z',
      },
    });

    expect(stage).toBe(5);
  });
});
