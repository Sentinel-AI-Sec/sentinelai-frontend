import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProjectsApi } from '../../core/api/projects-api';
import { ScanApi } from '../../core/api/scan-api';
import { Page, ScanListItem } from '../../core/api/wire';
import { ScanHistoryPage } from './scan-history-page';

function scan(overrides: Partial<ScanListItem> = {}): ScanListItem {
  return {
    scan_job_id: '8f2c1d4a-0000-4000-8000-000000000000',
    project_id: 'p1',
    repo_url: 'https://github.com/example/repo.git',
    pr_ref: 'refs/pull/42/merge',
    commit_sha: 'abc1234def5678',
    status: 'completed',
    stage: 'report',
    report_id: null,
    bundle_purged: true,
    corpus_version: 'v1',
    failure_reason: null,
    started_at: '2026-08-20T09:00:00Z',
    completed_at: '2026-08-20T09:04:00Z',
    ...overrides,
  };
}

function page(items: ScanListItem[], nextCursor: string | null = null): Page<ScanListItem> {
  return { items, next_cursor: nextCursor, limit: 25 };
}

describe('ScanHistoryPage', () => {
  function render(listScans: ReturnType<typeof vi.fn>, projects: unknown[] = []) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ScanApi, useValue: { listScans } },
        { provide: ProjectsApi, useValue: { list: () => of(projects) } },
      ],
    });

    const fixture = TestBed.createComponent(ScanHistoryPage);
    fixture.detectChanges();
    return fixture;
  }

  it('reads the tenant-wide history, not one project', () => {
    // The whole point of the screen: a scan a colleague ran on another machine is still this
    // organisation's scan, so the first read carries no project filter.
    const listScans = vi.fn(() => of(page([scan()])));
    render(listScans);

    expect(listScans).toHaveBeenCalledTimes(1);
    expect(listScans.mock.calls[0][0]).toMatchObject({ projectId: undefined, limit: 25 });
  });

  it('offers a report link only when a report was retained', () => {
    // Retention is opt-in (SEC-35, "silence means delete"), so a completed scan with no report is
    // the ordinary case and must not look like a failure.
    const withReport = scan({ scan_job_id: 'a', report_id: 'r-1' });
    const without = scan({ scan_job_id: 'b', report_id: null });

    const fixture = render(vi.fn(() => of(page([withReport, without]))));
    const links = (fixture.nativeElement as HTMLElement).querySelectorAll('a[href^="/reports/"]');

    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/reports/r-1');
  });

  it('shows no count anywhere', () => {
    // The list endpoints expose no total, so any number would be the size of what happens to be
    // loaded presented as the size of the history.
    const fixture = render(vi.fn(() => of(page([scan(), scan({ scan_job_id: 'b' })], 'cursor-1'))));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).not.toMatch(/\b2 scans\b/);
    expect(text).toContain('Load more');
  });

  it('appends the next page rather than replacing what is on screen', () => {
    const first = scan({ scan_job_id: 'first' });
    const second = scan({ scan_job_id: 'second' });

    const listScans = vi
      .fn()
      .mockReturnValueOnce(of(page([first], 'cursor-1')))
      .mockReturnValueOnce(of(page([second], null)));

    const fixture = render(listScans);
    const component = fixture.componentInstance;

    component.loadMore();
    fixture.detectChanges();

    expect(listScans.mock.calls[1][0]).toMatchObject({ cursor: 'cursor-1' });
    expect(component.scans().map((s) => s.scan_job_id)).toEqual(['first', 'second']);
    expect(component.hasMore()).toBe(false);
  });

  it('explains an empty history rather than looking broken', () => {
    const fixture = render(vi.fn(() => of(page([]))));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No scans yet');
    expect(text).toContain('SentinelAI Action');
  });

  it('surfaces a failed read without blanking the screen', () => {
    const fixture = render(vi.fn(() => throwError(() => new Error('boom'))));

    expect(fixture.componentInstance.error()).toContain('Could not read');
  });

  it('shortens a repository url to owner/name', () => {
    const fixture = render(vi.fn(() => of(page([scan()]))));

    expect(fixture.componentInstance.repoLabel(scan())).toBe('example/repo');
  });
});
