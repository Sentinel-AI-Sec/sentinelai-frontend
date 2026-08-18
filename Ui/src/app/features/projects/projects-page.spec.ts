import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Auth } from '../../core/auth/auth';
import { ProjectDto, ProjectsApi } from '../../core/api/projects-api';
import { ProjectsPage } from './projects-page';

const projectA: ProjectDto = {
  projectId: 'p1',
  repoUrl: 'https://github.com/example/repo-a',
  defaultBranch: 'main',
  githubInstallationId: null,
};

class FakeAuth {
  constructor(private readonly roleValue: string) {}
  role() {
    return this.roleValue;
  }
}

describe('ProjectsPage', () => {
  function render(
    role: string,
    api: { list: () => Observable<ProjectDto[]>; create?: (...args: unknown[]) => Observable<ProjectDto> },
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: new FakeAuth(role) },
        { provide: ProjectsApi, useValue: api },
      ],
    });

    const fixture = TestBed.createComponent(ProjectsPage);
    fixture.detectChanges();
    return fixture;
  }

  it('lists the tenant’s projects on load', () => {
    const fixture = render('analyst', { list: () => of([projectA]) });

    expect(fixture.componentInstance.projects()).toEqual([projectA]);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('surfaces a load failure rather than an indefinite spinner', () => {
    const fixture = render('analyst', {
      list: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });

    expect(fixture.componentInstance.loading()).toBe(false);
    expect(fixture.componentInstance.loadError()).toContain('Could not load');
  });

  it('hides the create form for a non-admin role', () => {
    const fixture = render('analyst', { list: () => of([]) });

    expect(fixture.componentInstance.isAdmin).toBe(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('requires the admin role');
  });

  it('lets an admin register a project and adds it to the list', () => {
    const create = vi.fn(() => of(projectA));
    const fixture = render('admin', { list: () => of([]), create });

    fixture.componentInstance.repoUrl.set(projectA.repoUrl);
    fixture.componentInstance.create();

    expect(create).toHaveBeenCalledWith(projectA.repoUrl, undefined);
    expect(fixture.componentInstance.projects()).toEqual([projectA]);
    expect(fixture.componentInstance.repoUrl()).toBe('');
  });

  it('replaces, rather than duplicates, a re-registered project with the same id', () => {
    // ProjectsApi.create() already turns a 409 into a success carrying the existing project;
    // this is the component's half — the list must not grow when that happens.
    const create = vi.fn(() => of(projectA));
    const fixture = render('admin', { list: () => of([projectA]), create });

    fixture.componentInstance.repoUrl.set(projectA.repoUrl);
    fixture.componentInstance.create();

    expect(fixture.componentInstance.projects()).toEqual([projectA]);
  });

  it('names a 403 on create as the admin role being required', () => {
    const create = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 })));
    const fixture = render('admin', { list: () => of([]), create });

    fixture.componentInstance.repoUrl.set('https://github.com/example/repo-b');
    fixture.componentInstance.create();

    expect(fixture.componentInstance.createError()).toContain('admin role');
    expect(fixture.componentInstance.creating()).toBe(false);
  });
});
