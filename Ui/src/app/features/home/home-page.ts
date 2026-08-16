import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../core/config/environment';

/**
 * Where to go: open a report by id, or open the reference fixture's audit.
 *
 * A stopgap, honestly labelled as one. The real entry point is a project's scan history, which
 * needs a list endpoint the read API does not have yet (SEC-40 covers reading one scan, not
 * enumerating them). Rather than invent a fake list, this asks for the id the PR comment
 * already gives you.
 */
@Component({
  selector: 'app-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  private readonly router = inject(Router);

  readonly reportId = signal('');
  readonly demoMode = environment.useDemoData;

  open(): void {
    const id = this.reportId().trim();
    if (id) void this.router.navigate(['/reports', id]);
  }

  openDemo(): void {
    void this.router.navigate(['/reports', 'demo-report']);
  }
}
