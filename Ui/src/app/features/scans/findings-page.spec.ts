import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ScanApi } from '../../core/api/scan-api';
import { Finding, Page } from '../../core/api/wire';
import { FindingsPage } from './findings-page';

function finding(id: string, severity: number, layer: Finding['layer'] = 'code'): Finding {
  return {
    id,
    source_tool: 'roslyn-security',
    layer,
    severity,
    cwe_id: 'CWE-502',
    cve_id: null,
    node_ref: `code:${id}`,
    message: `message for ${id}`,
    redacted: false,
  };
}

type GetFindings = ScanApi['getFindings'];

describe('FindingsPage', () => {
  function render(getFindings: GetFindings) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ScanApi, useValue: { getFindings } },
      ],
    });

    const fixture = TestBed.createComponent(FindingsPage);
    fixture.componentRef.setInput('id', 's1');
    fixture.detectChanges();
    return fixture;
  }

  const firstPage: Page<Finding> = {
    items: [finding('a', 4), finding('b', 2, 'dep')],
    next_cursor: 'cursor-2',
    limit: 50,
  };

  it('renders a loaded page and reports the server-applied limit', () => {
    const fixture = render(() => of(firstPage));

    expect(fixture.componentInstance.findings().length).toBe(2);
    expect(fixture.componentInstance.appliedLimit()).toBe(50);
    expect(fixture.componentInstance.loading()).toBe(false);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('message for a');
    expect(text).toContain('critical');
  });

  it('sends the filters to the server rather than filtering the fetched page', () => {
    // A client-side filter over one cursor page would silently mean "the high-severity rows on
    // this page", which is a different and much weaker claim than the one the header makes.
    const getFindings = vi.fn(() => of(firstPage));
    const fixture = render(getFindings as unknown as GetFindings);

    fixture.componentInstance.setLayer('infra');
    fixture.componentInstance.setMinSeverity(3);

    expect(getFindings).toHaveBeenLastCalledWith('s1', {
      limit: 50,
      layer: 'infra',
      minSeverity: 3,
    });
  });

  it('omits min_severity when it is zero, so the request matches the unfiltered one', () => {
    const getFindings = vi.fn(() => of(firstPage));
    render(getFindings as unknown as GetFindings);

    expect(getFindings).toHaveBeenCalledWith('s1', { limit: 50 });
  });

  it('appends the next cursor page instead of replacing what is on screen', () => {
    const secondPage: Page<Finding> = {
      items: [finding('c', 1)],
      next_cursor: null,
      limit: 50,
    };
    const getFindings = vi.fn((_id: string, options: { cursor?: string } = {}) =>
      of(options.cursor ? secondPage : firstPage),
    );
    const fixture = render(getFindings as unknown as GetFindings);

    fixture.componentInstance.loadMore();

    expect(fixture.componentInstance.findings().map((f) => f.id)).toEqual(['a', 'b', 'c']);
    // Cursor exhausted — there is nothing further to offer.
    expect(fixture.componentInstance.nextCursor()).toBeNull();
  });

  it('counts severities across everything loaded, not just the last page', () => {
    const fixture = render(() => of(firstPage));

    // Buckets are indexed by severity: two rows, one critical (4) and one medium (2).
    expect(fixture.componentInstance.counts()).toEqual([0, 0, 1, 0, 1]);
  });

  it('explains a 404 as a scan that is missing or belongs to another tenant', () => {
    const fixture = render(
      (() =>
        throwError(() => new HttpErrorResponse({ status: 404 }))) as unknown as GetFindings,
    );

    expect(fixture.componentInstance.error()).toContain('No such scan');
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('reloads when the route id changes rather than leaving the previous scan on screen', () => {
    const getFindings = vi.fn(() => of(firstPage));
    const fixture = render(getFindings as unknown as GetFindings);

    fixture.componentRef.setInput('id', 's2');
    fixture.detectChanges();

    expect(getFindings).toHaveBeenLastCalledWith('s2', { limit: 50 });
  });
});

