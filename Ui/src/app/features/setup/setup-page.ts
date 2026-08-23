import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { MachineTokenApi, MachineTokenDto } from '../../core/api/machine-token-api';
import { ProjectDto, ProjectsApi } from '../../core/api/projects-api';
import { environment } from '../../core/config/environment';

/** One of the three values, as the page renders it. */
export interface SetupValue {
  /** The GitHub name it is set under. */
  name: string;
  /** `variable` is world-readable in Actions logs; `secret` is masked. */
  kind: 'variable' | 'secret';
  /** The value itself, or null while it has not been resolved yet. */
  value: string | null;
  /** One line on what it is for. */
  hint: string;
}

/**
 * The three values a repository needs before the Action can scan it, on one screen.
 *
 * `sentinelai.yml` in a consumer repository reads exactly three names —
 * `vars.SENTINELAI_BACKEND_URL`, `vars.SENTINELAI_PROJECT_ID` and
 * `secrets.SENTINELAI_MACHINE_TOKEN` — and until this screen existed a person setting CI up had
 * to assemble them from three unrelated places: read the deployed API's URL off a deployment,
 * copy a project id from the projects screen, and mint the token by running a Python script
 * against the API's raw `Authentication:Jwt:SigningKey`. That last step is the one this replaces
 * and the reason the screen is worth having: the signing key forges any token for any tenant, and
 * handing it to whoever is wiring up a repository is a far larger grant than the credential they
 * actually needed.
 *
 * **The token is shown once and is not stored anywhere.** The API keeps no copy, so there is
 * nothing to fetch back — leaving the screen loses it, and the recovery is to mint another. The
 * page says so where the token appears rather than in a footnote, because someone who navigates
 * away first and reads the caveat second has already lost it.
 */
@Component({
  selector: 'app-setup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './setup-page.html',
  styleUrl: './setup-page.css',
})
export class SetupPage {
  private readonly projectsApi = inject(ProjectsApi);
  private readonly machineTokenApi = inject(MachineTokenApi);
  protected readonly auth = inject(Auth);

  readonly projects = signal<ProjectDto[]>([]);
  readonly loadingProjects = signal(true);
  readonly projectsError = signal<string | null>(null);
  readonly selectedProjectId = signal<string>('');

  readonly minting = signal(false);
  readonly mintError = signal<string | null>(null);
  readonly minted = signal<MachineTokenDto | null>(null);
  /** Whether the token is rendered in full. Off until asked for, so it is not shoulder-read. */
  readonly tokenRevealed = signal(false);

  /** Which value was last copied, so each button can confirm without a toast system. */
  readonly copiedName = signal<string | null>(null);

  readonly isAdmin = this.auth.role() === 'admin';
  readonly demoMode = environment.useDemoData;

  /**
   * The API base URL the Action should POST its bundle to.
   *
   * `environment.apiBaseUrl` is empty in a development build on purpose — requests go
   * same-origin and `proxy.conf.json` forwards them — so falling back to the current origin is
   * what makes this correct rather than blank there. A deployed build has the absolute URL and
   * uses it. Either way the value is the one *this browser* is talking to, which is the only
   * honest answer: a scan uploaded to a different API would not appear on this console.
   */
  readonly backendUrl = computed(() =>
    (environment.apiBaseUrl || window.location.origin).replace(/\/+$/, ''),
  );

  readonly selectedProject = computed(
    () => this.projects().find((p) => p.projectId === this.selectedProjectId()) ?? null,
  );

  /** The three rows, in the order the workflow reads them. */
  readonly values = computed<SetupValue[]>(() => [
    {
      name: 'SENTINELAI_BACKEND_URL',
      kind: 'variable',
      value: this.backendUrl(),
      hint: 'Where the Action uploads the bundle and polls the scan.',
    },
    {
      name: 'SENTINELAI_PROJECT_ID',
      kind: 'variable',
      value: this.selectedProjectId() || null,
      hint: 'Which registered repository the scan belongs to. A bundle whose project id matches no project is rejected.',
    },
    {
      name: 'SENTINELAI_MACHINE_TOKEN',
      kind: 'secret',
      value: this.minted()?.token ?? null,
      hint: 'How the Action authenticates. A secret, not a variable — a variable is readable by anyone who can read the repository.',
    },
  ]);

  /** How many of the three are filled in — the header counts down from three. */
  readonly readyCount = computed(() => this.values().filter((value) => value.value !== null).length);

  /** True once all three have a value, which is when the repository is actually set up. */
  readonly complete = computed(() => this.readyCount() === this.values().length);

  /**
   * The `gh` commands that set all three, ready to paste.
   *
   * Rendered with the token in full even while the panel above is masking it: this block exists
   * to be copied into a terminal, and a masked value copied out of it would silently set the
   * secret to a row of dots.
   */
  readonly ghCommands = computed(() => {
    const repo = this.repoSlug() || '<owner>/<repo>';
    const token = this.minted()?.token ?? '<paste the token above>';
    return [
      `gh variable set SENTINELAI_BACKEND_URL -R ${repo} --body "${this.backendUrl()}"`,
      `gh variable set SENTINELAI_PROJECT_ID -R ${repo} --body "${this.selectedProjectId() || '<pick a project above>'}"`,
      `gh secret set SENTINELAI_MACHINE_TOKEN -R ${repo} --body "${token}"`,
    ].join('\n');
  });

  constructor() {
    this.loadProjects();
  }

  loadProjects(): void {
    this.loadingProjects.set(true);
    this.projectsError.set(null);

    this.projectsApi.list().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loadingProjects.set(false);
        // Preselect when there is no choice to make. With several, leaving it unset is
        // deliberate — silently defaulting to the first would let someone copy the wrong id
        // without ever having looked at the field.
        if (projects.length === 1) this.selectedProjectId.set(projects[0].projectId);
      },
      error: () => {
        this.loadingProjects.set(false);
        this.projectsError.set('Could not load projects.');
      },
    });
  }

  mint(): void {
    if (this.minting()) return;

    this.minting.set(true);
    this.mintError.set(null);

    this.machineTokenApi.mint().subscribe({
      next: (token) => {
        this.minting.set(false);
        this.minted.set(token);
        this.tokenRevealed.set(false);
      },
      error: (err: unknown) => {
        this.minting.set(false);
        this.mintError.set(
          err instanceof HttpErrorResponse && err.status === 403
            ? 'The admin role is required to issue a machine token.'
            : 'Could not issue a machine token.',
        );
      },
    });
  }

  toggleReveal(): void {
    this.tokenRevealed.update((revealed) => !revealed);
  }

  /**
   * Copies one value. The Clipboard API is absent over plain HTTP and in some embedded browsers,
   * so the failure path leaves the value on screen to select by hand rather than reporting a
   * copy that did not happen.
   */
  copy(name: string, value: string | null): void {
    if (!value) return;

    void navigator.clipboard?.writeText(value).then(
      () => {
        this.copiedName.set(name);
        setTimeout(() => {
          if (this.copiedName() === name) this.copiedName.set(null);
        }, 1600);
      },
      () => this.copiedName.set(null),
    );
  }

  /** The token with its middle removed, for the masked state. */
  maskedToken(token: string): string {
    return token.length > 24 ? `${token.slice(0, 12)}…${token.slice(-6)}` : token;
  }

  /** `owner/repo` off the selected project's URL, for the `gh -R` flag. Best effort. */
  repoSlug(): string | null {
    const repoUrl = this.selectedProject()?.repoUrl;
    if (!repoUrl) return null;

    try {
      const segments = new URL(repoUrl).pathname
        .replace(/\.git$/, '')
        .split('/')
        .filter(Boolean);
      return segments.length >= 2 ? segments.slice(-2).join('/') : null;
    } catch {
      return null;
    }
  }
}
