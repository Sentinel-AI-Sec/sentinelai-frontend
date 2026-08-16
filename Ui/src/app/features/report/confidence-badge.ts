import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Confidence } from '../../core/api/wire';

/**
 * How much a join can be trusted.
 *
 * This is the single most important thing on the screen, and the easiest to render
 * dishonestly. The product's whole claim is that it says when it is unsure — so the tier is
 * never hidden behind a colour alone: it is spelled out, and it carries the reason on hover.
 * A reader who ignores every other element must still be unable to mistake an inferred chain
 * for a proven one.
 */
@Component({
  selector: 'app-confidence-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [class]="'badge--' + level()" [title]="explanation()">
      <span class="dot" aria-hidden="true"></span>
      {{ label() }}
    </span>
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      border: 1px solid transparent;
      white-space: nowrap;
    }

    .dot {
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 50%;
      background: currentColor;
    }

    .badge--certain {
      color: var(--tier-certain);
      background: color-mix(in srgb, var(--tier-certain) 12%, transparent);
      border-color: color-mix(in srgb, var(--tier-certain) 35%, transparent);
    }

    .badge--inferred {
      color: var(--tier-inferred);
      background: color-mix(in srgb, var(--tier-inferred) 12%, transparent);
      border-color: color-mix(in srgb, var(--tier-inferred) 35%, transparent);
    }

    .badge--unresolved {
      color: var(--tier-unresolved);
      background: color-mix(in srgb, var(--tier-unresolved) 12%, transparent);
      border-color: color-mix(in srgb, var(--tier-unresolved) 35%, transparent);
      border-style: dashed;
    }
  `,
})
export class ConfidenceBadge {
  /** Null renders as the seed hop's "start" state rather than as a missing value. */
  readonly level = input.required<Confidence | null>();

  readonly label = computed(() => this.level() ?? 'start');

  readonly explanation = computed(() => {
    switch (this.level()) {
      case 'certain':
        return 'Confirmed against the real configuration.';
      case 'inferred':
        return (
          'Convention-based — for example an image-name match rather than a digest. ' +
          'Usable, but worth checking by hand.'
        );
      case 'unresolved':
        return (
          'The join could not be confirmed from the artifacts in this bundle. ' +
          'A potential chain with an unverified link, not a proven one.'
        );
      default:
        return 'The first step of the chain. Nothing precedes it, so there is no join to rate.';
    }
  });
}
