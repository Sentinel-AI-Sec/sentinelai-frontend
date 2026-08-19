import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ScanApi } from '../../core/api/scan-api';
import { Chain, Finding, Page, Report } from '../../core/api/wire';
import { ReportPage } from './report-page';

function chain(id: string, status: Chain['status'], priority: number): Chain {
  return {
    id,
    priority,
    hop_count: 1,
    status,
    min_confidence: 'certain',
    hops: [
      {
        order: 1,
        technique_id: 'T1190',
        blue_validated: status === 'validated',
        edge_confidence: null,
        finding_id: null,
        node_key: `code:${id}`,
      },
    ],
  };
}

const report: Report = {
  report_id: 'r1',
  scan_job_id: 's1',
  framing: 'draft_audit',
  summary: 'summary text',
  corpus_version: '2026-07-15',
  created_at: '2026-08-16T09:14:22Z',
  retained: true,
  chains: [
    chain('live', 'validated', 1),
    chain('open', 'candidate', 2),
    chain('dead', 'rejected', 3),
  ],
  citations: [{ knowledge_id: 'T1530', source: 'ATT&CK', collection: 'offense' }],
  cost: { currency: 'USD', total: 0.4, model_calls: 9, rated: true },
};

class StubApi {
  readonly requested: string[] = [];

  getReport(id: string): Observable<Report> {
    this.requested.push(id);
    return of({ ...report, report_id: id, scan_job_id: `scan-for-${id}` });
  }
  getFindings(): Observable<Page<Finding>> {
    return of({ items: [], next_cursor: null, limit: 50 });
  }
}

describe('ReportPage', () => {
  function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ScanApi, useClass: StubApi },
      ],
    });

    const fixture = TestBed.createComponent(ReportPage);
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    return fixture;
  }

  it('demotes a rejected chain and keeps the others up top', async () => {
    // `rejected` is the backend's spelling — ChainStatus is Candidate|Asserted|Validated|
    // Rejected, with no "refuted" anywhere. Matching the wrong word put every chain Blue threw
    // out back beside the real ones, which is the opposite of what this section is for.
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    const page = fixture.componentInstance;
    expect(page.liveChains().map((c) => c.id)).toEqual(['live', 'open']);
    expect(page.rejectedChains().map((c) => c.id)).toEqual(['dead']);
  });

  it('renders the rejected section under its own heading', async () => {
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Refuted by Blue');
    expect(text).toContain('Candidate chains');
  });

  it('reloads when the route id changes on a reused component', async () => {
    // The router reuses this component when only the :id segment changes, so loading once at
    // construction leaves the previous report on screen under the new URL — the reader is
    // looking at someone else's audit with no indication anything is stale.
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentRef.setInput('id', 'r2');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const api = TestBed.inject(ScanApi) as unknown as StubApi;
    expect(api.requested).toEqual(['r1', 'r2']);
    expect(fixture.componentInstance.report()?.report_id).toBe('r2');
  });

  it('explains a 404 in words a person can act on', async () => {
    // "No such report — or it belongs to another tenant" is deliberate: the API returns 404 for
    // both, because telling them apart would confirm that someone else's report exists.
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ScanApi,
          useValue: {
            getReport: () =>
              throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
            getFindings: () => of({ items: [], next_cursor: null, limit: 50 }),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ReportPage);
    fixture.componentRef.setInput('id', 'missing');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No such report');
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('still renders the chains when the findings call fails', async () => {
    // Evidence is a nice-to-have; the chains are the point. A partial audit is more use than an
    // error page, so a failed findings fetch must not take the report down with it.
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ScanApi,
          useValue: {
            getReport: () => of(report),
            getFindings: () => throwError(() => new HttpErrorResponse({ status: 500 })),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ReportPage);
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toBeNull();
    expect(fixture.componentInstance.liveChains().length).toBe(2);
  });

  it('says so plainly when a scan produced no chains', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ScanApi,
          useValue: {
            getReport: () => of({ ...report, chains: [], citations: [] }),
            getFindings: () => of({ items: [], next_cursor: null, limit: 50 }),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ReportPage);
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // "That is a result, not an error" — an empty audit is a finding about the repository, and
    // a blank panel would read as a broken screen.
    expect(text).toContain('No chain reached a sensitive resource');
    expect(text).toContain('No knowledge was cited');
  });

  it('shows the summary and the citations', async () => {
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('summary text');
    expect(text).toContain('T1530');
  });
});
