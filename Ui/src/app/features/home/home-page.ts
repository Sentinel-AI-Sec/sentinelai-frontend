import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { ChainIllustration } from '../../shared/chain-illustration/chain-illustration';
import { ProjectDto, ProjectsApi } from '../../core/api/projects-api';
import { Recents } from '../../core/history/recents';
import { environment } from '../../core/config/environment';

/** One stage of the pipeline, for the explainer strip. Mirrors `ScanStage` in declaration order. */
interface Stage {
  name: string;
  icon: string;
  blurb: string;
}

/**
 * The console landing screen.
 *
 * Every number on a screen like this is a promise that the product knows something. This one shows
 * the tenant's registered projects (a real list endpoint), what this browser has opened (a local
 * index, labelled as one), and the jump-in-by-id route the PR comment gives you.
 *
 * `GET /v1/scans` has since landed, so a fleet-wide list is no longer something the UI would have
 * to invent — `/scans` renders it. What is still off the table is a *derived* tile: the list
 * endpoints expose no total (see `docs/Read_API.md`), so "247 scans this week" would mean counting
 * a page and presenting it as a population. A count of what happens to be loaded is not a count.
 */
@Component({
  selector: 'app-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, ChainIllustration],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  private readonly router = inject(Router);
  private readonly projectsApi = inject(ProjectsApi);
  protected readonly auth = inject(Auth);
  protected readonly recents = inject(Recents);

  readonly reportId = signal('');
  readonly scanId = signal('');
  readonly demoMode = environment.useDemoData;

  readonly projects = signal<ProjectDto[]>([]);
  readonly projectsLoading = signal(true);
  readonly projectsError = signal<string | null>(null);

  readonly scopes = computed(() => this.auth.session()?.scopes ?? []);
  readonly canWrite = computed(() => this.scopes().includes('scan:write'));

  protected readonly stages: Stage[] = [
    { name: 'Received', icon: 'inbox', blurb: 'Bundle ingested, secrets redacted at the door.' },
    { name: 'Normalize', icon: 'transform', blurb: 'Scanner output folded into one finding shape.' },
    { name: 'Graph', icon: 'hub', blurb: 'Nodes and edges joined across code, deps and infra.' },
    { name: 'Retrieve', icon: 'database', blurb: 'Corpus knowledge pulled for the agents to cite.' },
    { name: 'Debate', icon: 'forum', blurb: 'Red proposes, Blue attacks, the Reporter concludes.' },
    { name: 'Report', icon: 'description', blurb: 'A draft audit, with a tier on every join.' },
  ];

  constructor() {
    this.loadProjects();
  }

  loadProjects(): void {
    this.projectsLoading.set(true);
    this.projectsError.set(null);

    this.projectsApi.list().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.projectsLoading.set(false);
      },
      error: () => {
        this.projectsLoading.set(false);
        this.projectsError.set('Could not load projects.');
      },
    });
  }

  open(): void {
    const id = this.reportId().trim();
    if (id) void this.router.navigate(['/reports', id]);
  }

  openScan(): void {
    const id = this.scanId().trim();
    if (id) void this.router.navigate(['/scans', id, 'ops']);
  }

  openDemo(): void {
    void this.router.navigate(['/reports', 'demo-report']);
  }

  forget(kind: 'scan' | 'report', id: string): void {
    this.recents.forget(kind, id);
  }

  /** The repo name alone reads better in a tile than the whole clone URL. */
  repoName(repoUrl: string): string {
    const trimmed = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
    const parts = trimmed.split('/').filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join('/') : trimmed;
  }
}
