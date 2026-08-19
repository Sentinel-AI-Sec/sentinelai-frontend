import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Auth } from '../../core/auth/auth';
import { ScanApi } from '../../core/api/scan-api';
import {
  RunAuditStageResponse,
  RunGraphStageResponse,
  ScanOpsApi,
} from '../../core/api/scan-ops-api';
import { ScanJobResponse } from '../../core/api/wire';
import { ScanOpsPage } from './scan-ops-page';

const job: ScanJobResponse = {
  scanJobId: 's1',
  status: 1,
  stage: 2,
  corpusVersion: '2026-07-15',
  bundlePurged: false,
  failureReason: null,
  startedAt: '2026-08-16T09:00:00Z',
  completedAt: null,
};

const graphResult: RunGraphStageResponse = {
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
  disclaimer: 'disclaimer',
};

const auditResult: RunAuditStageResponse = {
  scan_job_id: 's1',
  report_id: 'r1',
  report_retained: true,
  bundle_purged: true,
  framing: 'draft_audit',
  summary: 'summary',
  outcome: 'ChainConfirmed',
  rounds: 3,
  citations: 2,
};

class FakeAuth {
  constructor(
    private readonly canWrite: boolean,
    private readonly admin: boolean,
  ) {}
  hasScope() {
    return this.canWrite;
  }
  role() {
    return this.admin ? 'admin' : 'analyst';
  }
}

describe('ScanOpsPage', () => {
  function render(options: {
    canWrite?: boolean;
    admin?: boolean;
    getScanJob?: (id: string) => Observable<ScanJobResponse>;
    runGraphStage?: () => Observable<RunGraphStageResponse>;
    runAuditStage?: () => Observable<RunAuditStageResponse>;
    purge?: () => Observable<ScanJobResponse>;
  }) {
    const getScanJob = options.getScanJob ?? (() => of(job));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: new FakeAuth(options.canWrite ?? true, options.admin ?? true) },
        { provide: ScanApi, useValue: { getScanJob } },
        {
          provide: ScanOpsApi,
          useValue: {
            runGraphStage: options.runGraphStage,
            runAuditStage: options.runAuditStage,
            purge: options.purge,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ScanOpsPage);
    fixture.componentRef.setInput('id', 's1');
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the job status for the routed id', () => {
    const getScanJob = vi.fn(() => of(job));
    const fixture = render({ getScanJob });

    expect(getScanJob).toHaveBeenCalledWith('s1');
    expect(fixture.componentInstance.job()).toEqual(job);
    expect(fixture.componentInstance.jobLoading()).toBe(false);
  });

  it('surfaces a status load failure', () => {
    const fixture = render({
      getScanJob: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });

    expect(fixture.componentInstance.jobError()).toContain('Could not load');
  });

  it('gates both stage runners behind scan:write', () => {
    const fixture = render({ canWrite: false });

    // One gate for "run graph stage", one for "run audit stage" — purge isn't scope-gated
    // (it's role-gated), so it must not contribute a third.
    const gates = (fixture.nativeElement as HTMLElement).querySelectorAll('.gate');
    expect(gates.length).toBe(2);
  });

  it('runs the graph stage and reloads the job status afterward', () => {
    const getScanJob = vi.fn(() => of(job));
    const runGraphStage = vi.fn(() => of(graphResult));
    const fixture = render({ getScanJob, runGraphStage });

    fixture.componentInstance.runGraphStage();

    expect(runGraphStage).toHaveBeenCalledWith('s1');
    expect(fixture.componentInstance.graphResult()).toEqual(graphResult);
    expect(fixture.componentInstance.graphRunning()).toBe(false);
    // Once on construction, once after the stage completes.
    expect(getScanJob).toHaveBeenCalledTimes(2);
  });

  it('reports a graph-stage failure without touching the job status', () => {
    const fixture = render({
      runGraphStage: () => throwError(() => new HttpErrorResponse({ status: 409 })),
    });

    fixture.componentInstance.runGraphStage();

    expect(fixture.componentInstance.graphError()).toContain('no stored bundle');
  });

  it('runs the audit stage and links to the retained report', () => {
    const runAuditStage = vi.fn(() => of(auditResult));
    const fixture = render({ runAuditStage });

    fixture.componentInstance.runAuditStage();
    fixture.detectChanges();

    expect(runAuditStage).toHaveBeenCalledWith('s1');
    expect(fixture.componentInstance.auditResult()?.report_id).toBe('r1');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('r1');
  });

  it('gates purge behind the admin role', () => {
    const fixture = render({ admin: false });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Requires the admin role');
  });

  it('does not purge without confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const purge = vi.fn(() => of(job));
    const fixture = render({ purge });

    fixture.componentInstance.purge();

    expect(purge).not.toHaveBeenCalled();
  });

  it('purges once confirmed and updates the shown job', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const purged: ScanJobResponse = { ...job, bundlePurged: true };
    const purge = vi.fn(() => of(purged));
    const fixture = render({ purge });

    fixture.componentInstance.purge();

    expect(purge).toHaveBeenCalledWith('s1');
    expect(fixture.componentInstance.job()?.bundlePurged).toBe(true);
  });
});
