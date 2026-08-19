import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * Sub-navigation between the three views of one scan job.
 *
 * There is deliberately no "Report" tab. A report is addressed by its own id, which the audit
 * stage mints and which is not the scan job id — a tab that guessed `/reports/{scanJobId}`
 * would 404 on every scan that has one, which is worse than not offering the link. The ops
 * screen links the real report id once the audit stage hands it back.
 */
@Component({
  selector: 'app-scan-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="tabs" aria-label="Scan views">
      <a
        class="tab"
        [routerLink]="['/scans', scanJobId(), 'ops']"
        routerLinkActive="is-active"
      >
        <span class="ms ms--sm" aria-hidden="true">conversion_path</span>
        Pipeline
      </a>
      <a
        class="tab"
        [routerLink]="['/scans', scanJobId(), 'findings']"
        routerLinkActive="is-active"
      >
        <span class="ms ms--sm" aria-hidden="true">bug_report</span>
        Findings
      </a>
      <a
        class="tab"
        [routerLink]="['/scans', scanJobId(), 'graph']"
        routerLinkActive="is-active"
      >
        <span class="ms ms--sm" aria-hidden="true">hub</span>
        Resource graph
      </a>
    </nav>
  `,
})
export class ScanTabs {
  readonly scanJobId = input.required<string>();
}
