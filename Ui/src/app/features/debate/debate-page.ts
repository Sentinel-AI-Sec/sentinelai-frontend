import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { DebateApi, DebateResponse } from '../../core/api/debate-api';
import { environment } from '../../core/config/environment';

/** The four speakers, lower-cased into something a class name can be built from. */
type Speaker = 'red' | 'blue' | 'reporter' | 'orchestrator' | 'other';

/**
 * Runs the Red/Blue/Reporter debate directly (`POST /v1/debates`, `.../demo`).
 *
 * A dev/ops exercise surface, not the product's real path — see `DebateApi`'s remarks. A live
 * run is 4–7 sequential model calls (90–140s against NIM), so the button stays disabled and
 * says so rather than looking stuck.
 *
 * The transcript is laid out as a conversation rather than as a log, because that is what it
 * is: Red proposes, Blue attacks, the Reporter adjudicates. Reading who-said-what is the whole
 * value of having the transcript at all, and a flat list of paragraphs hides it.
 */
@Component({
  selector: 'app-debate-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './debate-page.html',
  styleUrl: './debate-page.css',
})
export class DebatePage {
  private readonly api = inject(DebateApi);

  readonly scanJobId = signal('');
  readonly resourceGraph = signal('');

  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<DebateResponse | null>(null);

  readonly demoMode = environment.useDemoData;

  /**
   * Whether anything at all went wrong with the reasoning (SEC-50).
   *
   * Both warning lists mean the same class of problem — the Reporter's chain does not match the
   * graph it was given — so the panel appears if either is non-empty, and the two are labelled
   * separately inside it.
   */
  readonly hasIntegrityWarnings = computed(() => {
    const result = this.result();
    if (!result) return false;
    return result.edgeIntegrityWarnings.length > 0 || result.abandonedReasoningWarnings.length > 0;
  });

  run(): void {
    if (this.running()) return;
    this.start(
      this.api.run(this.scanJobId().trim() || undefined, this.resourceGraph().trim() || undefined),
    );
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

  /** The role as sent is capitalised prose; the template needs a stable key to style against. */
  speaker(role: string): Speaker {
    const key = role.trim().toLowerCase();
    return key === 'red' || key === 'blue' || key === 'reporter' || key === 'orchestrator'
      ? key
      : 'other';
  }

  initial(role: string): string {
    return (role.trim()[0] ?? '?').toUpperCase();
  }

  /**
   * Maps a confidence word onto the shared tier chips.
   *
   * The debate spells its tiers capitalised (`Inferred`) while the read API spells them
   * lower-case (`inferred`); both arrive at the same chip so a join means the same thing
   * wherever it is read.
   */
  tierChip(confidence: string): string {
    switch (confidence.trim().toLowerCase()) {
      case 'certain':
        return 'chip chip--certain';
      case 'inferred':
        return 'chip chip--inferred';
      case 'unresolved':
        return 'chip chip--unresolved';
      default:
        return 'chip chip--mute';
    }
  }
}
