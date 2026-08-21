import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Auth } from '../../core/auth/auth';
import { BundleMetadataInput, ScanOpsApi, SubmitScanResponse } from '../../core/api/scan-ops-api';
import { NewScanPage } from './new-scan-page';

const submitted: SubmitScanResponse = {
  scanJobId: 's1',
  status: 0,
  corpusVersion: '2026-07-15',
  pollUrl: '/v1/scans/s1',
  bundleSha256: 'sha',
  createdAt: '2026-08-16T09:00:00Z',
};

class FakeAuth {
  constructor(
    private readonly hasScopeValue: boolean,
    private readonly roleValue: string = 'admin',
  ) {}
  hasScope() {
    return this.hasScopeValue;
  }
  /** Submitting a bundle by hand is an admin surface — see NewScanPage.isAdmin. */
  role() {
    return this.roleValue;
  }
  /** The screen files an accepted job into the tenant-keyed recents index on the way out. */
  tenantId() {
    return 'tenant-1';
  }
}

describe('NewScanPage', () => {
  function render(
    canWrite: boolean,
    submit?: (metadata: BundleMetadataInput, bundle: File) => ReturnType<ScanOpsApi['submit']>,
    role = 'admin',
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: new FakeAuth(canWrite, role) },
        { provide: ScanOpsApi, useValue: { submit } },
      ],
    });

    const fixture = TestBed.createComponent(NewScanPage);
    fixture.detectChanges();
    return fixture;
  }

  it('gates the whole form behind the scan:write scope', () => {
    const fixture = render(false);

    expect(fixture.componentInstance.canWrite).toBe(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('scan:write');
  });

  it('does not offer the by-hand form to a non-admin', () => {
    // Scans arrive from the Action; submitting a bundle by hand is not an everyday surface, so an
    // analyst is pointed at the history instead of the form.
    //
    // This is presentation only, and the test says so rather than implying otherwise: the server
    // authorises POST /v1/scans on the scan:write scope, which an analyst holds — it must, because
    // the Action's machine token carries that scope and no role at all.
    const submit = vi.fn();
    const fixture = render(true, submit, 'analyst');

    expect(fixture.componentInstance.isAdmin).toBe(false);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('admin operation');
    expect(text).not.toContain('Scanner versions');
  });

  it('refuses to submit without a chosen bundle file', () => {
    const submit = vi.fn();
    const fixture = render(true, submit);

    fixture.componentInstance.projectId.set('proj-1');
    fixture.componentInstance.submit();

    expect(submit).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('Choose a .tar.gz bundle');
  });

  it('refuses to submit malformed scanner-versions JSON', () => {
    const submit = vi.fn();
    const fixture = render(true, submit);

    fixture.componentInstance.projectId.set('proj-1');
    fixture.componentInstance.bundleFile.set(new File(['x'], 'b.tar.gz'));
    fixture.componentInstance.scannerVersionsJson.set('{not json');
    fixture.componentInstance.submit();

    expect(submit).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('valid JSON');
  });

  it('builds the metadata part exactly and shows the accepted job on success', () => {
    const submit = vi.fn(() => of(submitted));
    const fixture = render(true, submit);

    const bundle = new File(['x'], 'b.tar.gz');
    fixture.componentInstance.projectId.set(' proj-1 ');
    fixture.componentInstance.prRef.set('refs/pull/1/merge');
    fixture.componentInstance.commitSha.set('sha1');
    fixture.componentInstance.modelTierHint.set('premium');
    fixture.componentInstance.retainReport.set(false);
    fixture.componentInstance.runnerSecretScan.set('passed');
    fixture.componentInstance.scannerVersionsJson.set('{"trivy":"1"}');
    fixture.componentInstance.bundleFile.set(bundle);

    fixture.componentInstance.submit();

    expect(submit).toHaveBeenCalledWith(
      {
        project_id: 'proj-1',
        pr_ref: 'refs/pull/1/merge',
        commit_sha: 'sha1',
        model_tier_hint: 'premium',
        retain_report: false,
        runner_secret_scan: 'passed',
        scanner_versions: { trivy: '1' },
        artifacts: [],
      },
      bundle,
    );
    expect(fixture.componentInstance.submitted()).toEqual(submitted);
  });

  it('names a 403 as a missing scan:write scope', () => {
    const submit = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 })));
    const fixture = render(true, submit);

    fixture.componentInstance.projectId.set('proj-1');
    fixture.componentInstance.bundleFile.set(new File(['x'], 'b.tar.gz'));
    fixture.componentInstance.submit();

    expect(fixture.componentInstance.error()).toContain('scan:write');
  });

  it('surfaces the backend’s own detail message on a 400', () => {
    const submit = vi.fn(() =>
      throwError(
        () => new HttpErrorResponse({ status: 400, error: { message: 'unknown project_id' } }),
      ),
    );
    const fixture = render(true, submit);

    fixture.componentInstance.projectId.set('bad-id');
    fixture.componentInstance.bundleFile.set(new File(['x'], 'b.tar.gz'));
    fixture.componentInstance.submit();

    expect(fixture.componentInstance.error()).toContain('unknown project_id');
  });

  it('navigates to the ops page for the job that was just submitted', () => {
    const fixture = render(true, () => of(submitted));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    fixture.componentInstance.projectId.set('proj-1');
    fixture.componentInstance.bundleFile.set(new File(['x'], 'b.tar.gz'));
    fixture.componentInstance.submit();
    fixture.componentInstance.openOps();

    expect(navigateSpy).toHaveBeenCalledWith(['/scans', 's1', 'ops']);
  });
});
