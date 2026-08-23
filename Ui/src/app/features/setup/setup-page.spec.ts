import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MachineTokenApi, MachineTokenDto } from '../../core/api/machine-token-api';
import { ProjectDto, ProjectsApi } from '../../core/api/projects-api';
import { Auth } from '../../core/auth/auth';
import { SetupPage } from './setup-page';

const project = (projectId: string, repoUrl: string): ProjectDto => ({
  projectId,
  repoUrl,
  defaultBranch: 'main',
  githubInstallationId: null,
});

const token: MachineTokenDto = {
  token: 'header.payload.signature-that-is-long-enough-to-be-masked',
  expiresAt: '2027-01-01T00:00:00Z',
  scopes: ['scan:write', 'scan:read', 'report:read'],
  tenantId: 'tenant-1',
};

class FakeAuth {
  constructor(private readonly roleValue: string) {}
  role() {
    return this.roleValue;
  }
  tenantId() {
    return 'tenant-1';
  }
}

describe('SetupPage', () => {
  function render(options: {
    role?: string;
    projects?: ProjectDto[];
    listFails?: boolean;
    mint?: () => ReturnType<MachineTokenApi['mint']>;
  }) {
    const list = vi.fn(() =>
      options.listFails
        ? throwError(() => new HttpErrorResponse({ status: 500 }))
        : of(options.projects ?? []),
    );
    const mint = vi.fn(options.mint ?? (() => of(token)));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: new FakeAuth(options.role ?? 'admin') },
        { provide: ProjectsApi, useValue: { list } },
        { provide: MachineTokenApi, useValue: { mint } },
      ],
    });

    const fixture = TestBed.createComponent(SetupPage);
    fixture.detectChanges();
    return { fixture, page: fixture.componentInstance, list, mint };
  }

  function text(fixture: ReturnType<typeof render>['fixture']): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  // ---- The three values ------------------------------------------------------------------

  /**
   * The screen exists to hand over three specific names. Naming them individually rather than
   * asserting a count, because the workflow reads them by name — a rename that kept the count at
   * three would leave the page looking right and the CI run failing.
   */
  it('names all three values the workflow reads, even before any are filled in', () => {
    const { fixture } = render({ projects: [] });

    expect(text(fixture)).toContain('SENTINELAI_BACKEND_URL');
    expect(text(fixture)).toContain('SENTINELAI_PROJECT_ID');
    expect(text(fixture)).toContain('SENTINELAI_MACHINE_TOKEN');
  });

  /**
   * `environment.apiBaseUrl` is empty under test, the same as in a development build, so this
   * pins the fallback that keeps the row from rendering blank there.
   */
  it('resolves the backend URL even when the build has no absolute API base', () => {
    const { page } = render({});

    expect(page.backendUrl()).toBe(window.location.origin);
    expect(page.values()[0].value).toBe(window.location.origin);
  });

  it('leaves the project id and the token unfilled until each is supplied', () => {
    const { page } = render({ projects: [project('p1', 'x'), project('p2', 'y')] });

    expect(page.values()[1].value).toBeNull();
    expect(page.values()[2].value).toBeNull();
    expect(page.complete()).toBe(false);
    expect(page.readyCount()).toBe(1);
  });

  // ---- Project selection -----------------------------------------------------------------

  it('preselects the only project when the tenant has exactly one', () => {
    const { page } = render({ projects: [project('only-one', 'https://github.com/acme/app')] });

    expect(page.selectedProjectId()).toBe('only-one');
    expect(page.values()[1].value).toBe('only-one');
  });

  /**
   * With several, nothing is chosen for you. Defaulting to the first would let someone copy an id
   * for a repository they never looked at, and the failure that causes — a bundle rejected for a
   * project id that is real but wrong — reads as a backend fault, not a mis-click here.
   */
  it('does not guess when the tenant has several projects', () => {
    const { page } = render({
      projects: [project('p1', 'https://github.com/acme/one'), project('p2', 'https://github.com/acme/two')],
    });

    expect(page.selectedProjectId()).toBe('');
  });

  it('reports a failed project list instead of rendering an empty one', () => {
    const { page } = render({ listFails: true });

    expect(page.projectsError()).toBe('Could not load projects.');
    expect(page.projects()).toEqual([]);
  });

  // ---- Minting ---------------------------------------------------------------------------

  it('hides the mint control from a non-admin rather than letting it 403', () => {
    const { fixture, page, mint } = render({ role: 'analyst' });

    expect(page.isAdmin).toBe(false);
    expect(text(fixture)).toContain('requires the admin role');
    expect(mint).not.toHaveBeenCalled();
  });

  it('fills the token row once one has been issued', () => {
    const { page } = render({ projects: [project('p1', 'https://github.com/acme/app')] });

    page.mint();

    expect(page.minted()?.token).toBe(token.token);
    expect(page.values()[2].value).toBe(token.token);
    expect(page.complete()).toBe(true);
  });

  /** Shown masked first — the panel is on screen for as long as it takes to paste it elsewhere. */
  it('does not reveal a freshly issued token until asked', () => {
    const { page } = render({});

    page.mint();

    expect(page.tokenRevealed()).toBe(false);
    expect(page.maskedToken(token.token)).not.toBe(token.token);
    expect(page.maskedToken(token.token)).toContain('…');
  });

  it('explains a 403 from the mint endpoint in the role it needs', () => {
    const { page } = render({
      mint: () => throwError(() => new HttpErrorResponse({ status: 403 })),
    });

    page.mint();

    expect(page.mintError()).toBe('The admin role is required to issue a machine token.');
    expect(page.minted()).toBeNull();
  });

  // ---- The gh block ----------------------------------------------------------------------

  /**
   * The block is copied into a terminal, so the token has to be in it in full even while the
   * panel above is masking it — a masked value pasted there sets the secret to a row of dots.
   */
  it('writes the token out in full in the gh commands', () => {
    const { page } = render({ projects: [project('p1', 'https://github.com/acme/app')] });

    page.mint();

    expect(page.ghCommands()).toContain(token.token);
    expect(page.ghCommands()).toContain('gh variable set SENTINELAI_BACKEND_URL');
    expect(page.ghCommands()).toContain('gh secret set SENTINELAI_MACHINE_TOKEN');
    expect(page.ghCommands()).toContain('-R acme/app');
  });

  it('leaves placeholders in the gh commands while values are still missing', () => {
    const { page } = render({
      projects: [project('p1', 'https://github.com/acme/one'), project('p2', 'https://github.com/acme/two')],
    });

    expect(page.ghCommands()).toContain('<owner>/<repo>');
    expect(page.ghCommands()).toContain('<pick a project above>');
    expect(page.ghCommands()).toContain('<paste the token above>');
  });

  it('falls back to a placeholder slug for a repo URL it cannot parse', () => {
    const { page } = render({ projects: [project('p1', 'not a url')] });

    expect(page.repoSlug()).toBeNull();
    expect(page.ghCommands()).toContain('<owner>/<repo>');
  });
});
