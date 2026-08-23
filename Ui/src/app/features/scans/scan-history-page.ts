import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ProjectDto, ProjectsApi } from '../../core/api/projects-api';
import { ScanApi } from '../../core/api/scan-api';
import { ScanListItem } from '../../core/api/wire';

/**
 * Every scan this organisation has run, newest first.
 *
 * <h3>Reviewing, not starting</h3>
 *
 * Scans are started by the GitHub Action, on a push, in the customer's own CI. Nothing on this
 * screen starts one, and that is the point rather than a missing feature: a console that could
 * start a scan would need a stored GitHub credential, and there is nowhere safe to keep one here
 * (see `docs/Retention_And_Purge.md` §4.1 — encryption at rest is not implemented on this host).
 * Not holding the credential is the privacy guarantee.
 *
 * <h3>Why this screen exists</h3>
 *
 * Until now a scan or a report could only be opened by pasting its GUID, or by finding it in this
 * browser's own {@link Recents} jump list. Neither survives changing machine, and neither shows a
 * scan a colleague ran. `GET /v1/scans` is server-side and tenant-scoped, so this is the first
 * view of the organisation's actual history.
 *
 * `report_id` on each row is the piece that matters: it is the only way to reach an audit without
 * typing an id. `ScanTabs` deliberately has no Report tab, because a tab guessing
 * `/reports/{scanJobId}` would 404 — a report is addressed by *report* id, and only the list knows
 * the mapping.
 *
 * <h3>Read-only, deliberately</h3>
 *
 * Every column and every action here is a read. `scan:read` is held by all three human roles
 * including `viewer`, so there is no gate and nothing to hide — which is what makes this the one
 * screen the whole team can share.
 */
@Component({
  selector: 'app-scan-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  templateUrl: './scan-history-page.html',
  styleUrl: './scan-history-page.css',
})
export class ScanHistoryPage {
  private readonly api = inject(ScanApi);
  private readonly projectsApi = inject(ProjectsApi);

  /** A page size that fills the screen without a scrollbar on a laptop. */
  private static readonly PAGE_SIZE = 25;

  readonly scans = signal<ScanListItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Set while a "Load more" is in flight, so the button can say so without blanking the table. */
  readonly loadingMore = signal(false);

  /**
   * The cursor for the next page, or null at the end.
   *
   * There is no total anywhere in this screen because the read API exposes none — see
   * `docs/Read_API.md` §"no counts". A number here would have to be invented, and an invented
   * count on a security console is exactly the kind of small lie this product is built not to
   * tell.
   */
  readonly nextCursor = signal<string | null>(null);

  readonly projects = signal<ProjectDto[]>([]);
  readonly projectFilter = signal<string>('');
  readonly statusFilter = signal<string>('');

  readonly hasMore = computed(() => this.nextCursor() !== null);

  /** True when a filter is narrowing the list, so the empty state can say which. */
  readonly filtered = computed(() => this.projectFilter() !== '' || this.statusFilter() !== '');

  constructor() {
    this.projectsApi.list().subscribe({
      // Best-effort: the filter is a convenience, and failing to populate it is not a reason to
      // withhold the history itself.
      next: (projects) => this.projects.set(projects),
      error: () => this.projects.set([]),
    });

    this.load();
  }

  /** Reads the first page, replacing whatever is on screen. */
  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.listScans(this.query()).subscribe({
      next: (page) => {
        this.scans.set(page.items);
        this.nextCursor.set(page.next_cursor);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not read this organisation’s scan history.');
      },
    });
  }

  /** Appends the next page. Never replaces — the rows already read stay put. */
  loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;

    this.loadingMore.set(true);

    this.api.listScans({ ...this.query(), cursor }).subscribe({
      next: (page) => {
        this.scans.update((rows) => [...rows, ...page.items]);
        this.nextCursor.set(page.next_cursor);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loadingMore.set(false);
        this.error.set('Could not read the next page.');
      },
    });
  }

  private query(): { projectId?: string; status?: string; limit: number } {
    return {
      projectId: this.projectFilter() || undefined,
      status: this.statusFilter() || undefined,
      limit: ScanHistoryPage.PAGE_SIZE,
    };
  }

  onProjectFilter(event: Event): void {
    this.projectFilter.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  onStatusFilter(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  clearFilters(): void {
    this.projectFilter.set('');
    this.statusFilter.set('');
    this.load();
  }

  /** How a row reads at a glance. */
  statusClass(scan: ScanListItem): string {
    switch (scan.status) {
      case 'completed':
        return 'chip--ok';
      case 'failed':
        return 'chip--danger';
      case 'running':
        return 'chip--accent';
      default:
        return 'chip--mute';
    }
  }

  /** The repository, without the host — a row is identified by the repo, not by the URL. */
  repoLabel(scan: ScanListItem): string {
    const trimmed = (scan.repo_url ?? '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const parts = trimmed.split('/').filter(Boolean);

    return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : trimmed;
  }

  shortSha(scan: ScanListItem): string {
    return scan.commit_sha ? scan.commit_sha.slice(0, 7) : '—';
  }
}
