import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../config/environment';
import { ProjectDto, ProjectsApi } from './projects-api';

describe('ProjectsApi against the real wire shapes', () => {
  let api: ProjectsApi;
  let http: HttpTestingController;
  const wasDemo = environment.useDemoData;

  beforeEach(() => {
    environment.useDemoData = false;

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    api = TestBed.inject(ProjectsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useDemoData = wasDemo;
    http.verify();
  });

  const project: ProjectDto = {
    projectId: 'p1',
    repoUrl: 'https://github.com/example/repo',
    defaultBranch: 'main',
    githubInstallationId: null,
  };

  it('unwraps the envelope on list()', () => {
    let projects: ProjectDto[] | undefined;
    api.list().subscribe((p) => (projects = p));

    http.expectOne('/v1/projects').flush({
      statusCode: 200,
      isSuccess: true,
      message: 'projects',
      data: [project],
    });

    expect(projects).toEqual([project]);
  });

  it('sends repoUrl/defaultBranch/githubInstallationId and unwraps the created project', () => {
    let created: ProjectDto | undefined;
    api.create('https://github.com/example/repo', 'develop').subscribe((p) => (created = p));

    const request = http.expectOne('/v1/projects');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      repoUrl: 'https://github.com/example/repo',
      defaultBranch: 'develop',
      githubInstallationId: null,
    });

    request.flush({ statusCode: 201, isSuccess: true, message: 'created', data: project });
    expect(created).toEqual(project);
  });

  it('sends null, not undefined, for an omitted default branch', () => {
    api.create('https://github.com/example/repo').subscribe();

    const request = http.expectOne('/v1/projects');
    expect(request.request.body.defaultBranch).toBeNull();
    request.flush({ statusCode: 201, isSuccess: true, message: 'created', data: project });
  });

  it('treats a 409 re-registration as success, surfacing the existing project rather than an error', () => {
    // The backend makes (tenant, repoUrl) idempotent: re-registering answers 409 carrying the
    // project that already exists. A caller that only handles 2xx would show this as a failure
    // for an action that, from the user's point of view, worked.
    let created: ProjectDto | undefined;
    let failed = false;
    api.create('https://github.com/example/repo').subscribe({
      next: (p) => (created = p),
      error: () => (failed = true),
    });

    const request = http.expectOne('/v1/projects');
    request.flush(
      { statusCode: 409, isSuccess: false, message: 'already registered', data: project },
      { status: 409, statusText: 'Conflict' },
    );

    expect(failed).toBe(false);
    expect(created).toEqual(project);
  });

  it('still fails on a 409 that carries no project data', () => {
    let failed = false;
    api.create('https://github.com/example/repo').subscribe({
      error: () => (failed = true),
    });

    http
      .expectOne('/v1/projects')
      .flush({ statusCode: 409, isSuccess: false, message: 'conflict', data: null }, {
        status: 409,
        statusText: 'Conflict',
      });

    expect(failed).toBe(true);
  });

  it('propagates a non-409 error untouched', () => {
    let failed = false;
    api.create('https://github.com/example/repo').subscribe({
      error: () => (failed = true),
    });

    http
      .expectOne('/v1/projects')
      .flush('forbidden', { status: 403, statusText: 'Forbidden' });

    expect(failed).toBe(true);
  });

  it('returns canned data and issues no request in demo mode', async () => {
    environment.useDemoData = true;

    const projects = await firstValueFrom(api.list());

    expect(projects.length).toBeGreaterThan(0);
    http.expectNone('/v1/projects');
  });
});
