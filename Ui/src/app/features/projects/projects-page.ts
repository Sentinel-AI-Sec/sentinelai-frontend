import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { ProjectDto, ProjectsApi } from '../../core/api/projects-api';
import { environment } from '../../core/config/environment';

/**
 * Registered repositories (`GET`/`POST /v1/projects`).
 *
 * Listing has no role gate — any signed-in member of the tenant needs it to make sense of a
 * report. Registering a new one is admin-only on the backend, so the create form is hidden for
 * anyone else rather than shown and left to fail.
 */
@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './projects-page.html',
  styleUrls: ['../../shared/forms.css', './projects-page.css'],
})
export class ProjectsPage {
  private readonly api = inject(ProjectsApi);
  protected readonly auth = inject(Auth);

  readonly projects = signal<ProjectDto[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly repoUrl = signal('');
  readonly defaultBranch = signal('');
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  readonly isAdmin = this.auth.role() === 'admin';
  readonly demoMode = environment.useDemoData;

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
}
