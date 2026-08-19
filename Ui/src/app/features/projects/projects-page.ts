import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { ProjectDto, ProjectsApi } from '../../core/api/projects-api';
import { environment } from '../../core/config/environment';

/** A project with the parts of its repo URL the card shows separately. */
export interface ProjectCard {
  project: ProjectDto;
  /** `org/repo` where the URL yields one, otherwise the URL itself. */
  name: string;
  /** The host, shown small underneath so two same-named repos on different forges are distinct. */
  host: string;
}

/**
 * Registered repositories (`GET`/`POST /v1/projects`).
 *
 * Listing has no role gate — any signed-in member of the tenant needs it to make sense of a
 * report. Registering a new one is admin-only on the backend, so the create form is hidden for
 * anyone else rather than shown and left to fail.
 *
 * The screen is built around copying the project id, not around reading the list: a bundle is
 * rejected unless its `metadata.project_id` matches one of these exactly, and re-typing a GUID
 * by hand is the single most likely way to get a 400 out of the submit form next door.
 */
@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.css',
})
export class ProjectsPage {
  private readonly api = inject(ProjectsApi);
  protected readonly auth = inject(Auth);

  private readonly repoUrlInput = viewChild<ElementRef<HTMLInputElement>>('repoUrlInput');

  readonly projects = signal<ProjectDto[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly repoUrl = signal('');
  readonly defaultBranch = signal('');
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  /** Which project id was last copied, so the button can confirm it without a toast system. */
  readonly copiedId = signal<string | null>(null);

  readonly isAdmin = this.auth.role() === 'admin';
  readonly demoMode = environment.useDemoData;

  readonly cards = computed<ProjectCard[]>(() =>
    this.projects().map((project) => ({
      project,
      name: repoName(project.repoUrl),
      host: repoHost(project.repoUrl),
    })),
  );

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.api.list().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('Could not load projects.');
      },
    });
  }

  create(): void {
    if (this.creating()) return;

    const repoUrl = this.repoUrl().trim();
    if (!repoUrl) return;

    this.creating.set(true);
    this.createError.set(null);

    this.api.create(repoUrl, this.defaultBranch().trim() || undefined).subscribe({
      next: (project) => {
        this.creating.set(false);
        this.repoUrl.set('');
        this.defaultBranch.set('');
        // A re-registration surfaces the same project id rather than a second row — replace it
        // in place instead of appending a duplicate.
        this.projects.update((existing) => [
          ...existing.filter((p) => p.projectId !== project.projectId),
          project,
        ]);
      },
      error: (err: unknown) => {
        this.creating.set(false);
        this.createError.set(
          err instanceof HttpErrorResponse && err.status === 403
            ? 'The admin role is required to register a project.'
            : 'Could not register that repository.',
        );
      },
    });
  }

  /** Sends the page to the create form and puts the caret in it, rather than only scrolling. */
  focusCreateForm(): void {
    const input = this.repoUrlInput()?.nativeElement;
    if (!input) return;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  }

  /**
   * Copies a project id. The Clipboard API is absent over plain HTTP and in some embedded
   * browsers, so the failure path leaves the id selectable on screen rather than pretending.
   */
  copy(projectId: string): void {
    void navigator.clipboard?.writeText(projectId).then(
      () => {
        this.copiedId.set(projectId);
        setTimeout(() => {
          if (this.copiedId() === projectId) this.copiedId.set(null);
        }, 1600);
      },
      () => this.copiedId.set(null),
    );
  }
}

function repoName(repoUrl: string): string {
  const path = parsePath(repoUrl);
  if (!path) return repoUrl;

  const segments = path.replace(/\.git$/, '').split('/').filter(Boolean);
  return segments.length >= 2 ? segments.slice(-2).join('/') : (segments[0] ?? repoUrl);
}

function repoHost(repoUrl: string): string {
  try {
    return new URL(repoUrl).host;
  } catch {
    return repoUrl;
  }
}

/** URL parsing is best-effort: `repoUrl` is whatever was registered, not a validated shape. */
function parsePath(repoUrl: string): string | null {
  try {
    return new URL(repoUrl).pathname;
  } catch {
    return null;
  }
}
