import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { DebateApi, DebateResponse } from '../../core/api/debate-api';
import { environment } from '../../core/config/environment';

/**
 * Runs the Red/Blue/Reporter debate directly (`POST /v1/debates`, `.../demo`).
 *
 * A dev/ops exercise surface, not the product's real path — see `DebateApi`'s remarks. A live
 * run is 4–7 sequential model calls (90–140s against NIM), so the button stays disabled and
 * says so rather than looking stuck.
 */
@Component({
  selector: 'app-debate-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './debate-page.html',
  styleUrls: ['../../shared/forms.css', './debate-page.css'],
})
export class DebatePage {
  private readonly api = inject(DebateApi);

  readonly scanJobId = signal('');
  readonly resourceGraph = signal('');

  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<DebateResponse | null>(null);

  readonly demoMode = environment.useDemoData;

  run(): void {
    if (this.running()) return;
    this.start(this.api.run(this.scanJobId().trim() || undefined, this.resourceGraph().trim() || undefined));
  }

  runDemo(): void {
    if (this.running()) return;
    this.start(this.api.runDemo());
  }

  /**
   * Subscribes to an already-constructed call and reports its outcome. The in-flight guard
   * lives in `run()`/`runDemo()`, not here — those build the `Observable` by calling `api.run`
   * or `api.runDemo`, which has to happen after the guard, not as part of constructing this
   * method's own argument, or a double-click would still invoke the API method (harmlessly for
   * a cold HTTP observable that is never subscribed, but not what "does not start a second run"
   * should mean).
   */
  private start(call: ReturnType<DebateApi['run']>): void {
    this.running.set(true);
    this.error.set(null);
    this.result.set(null);

    call.subscribe({
      next: (response) => {
        this.running.set(false);
        this.result.set(response);
      },
      error: (err: unknown) => {
        this.running.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 0
            ? 'Could not reach the backend. Is the API running?'
            : 'The debate failed to complete.',
        );
      },
    });
  }
}
