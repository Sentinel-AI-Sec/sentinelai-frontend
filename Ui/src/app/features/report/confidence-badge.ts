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
      padding: 0.15rem 0.6rem;
      border-radius: var(--radius-pill);
      font-family: var(--mono);
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border: 1px solid transparent;
      white-space: nowrap;
    }

    .dot {
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 50%;
      background: currentColor;
      flex: none;
    }

    .badge--certain {
      color: var(--tier-certain);
      background: rgba(107, 216, 203, 0.13);
      border-color: rgba(107, 216, 203, 0.35);
    }

    .badge--inferred {
      color: var(--tier-inferred);
      background: rgba(255, 194, 102, 0.13);
      border-color: rgba(255, 194, 102, 0.35);
    }

    /* Dashed, so the one tier that must never pass for a confirmed join stays distinguishable
       in greyscale and to a colour-blind reader — hue alone is not load-bearing here. */
    .badge--unresolved {
      color: var(--tier-unresolved);
      background: rgba(223, 183, 255, 0.13);
      border-color: rgba(223, 183, 255, 0.4);
      border-style: dashed;
    }

    /* The seed hop, which arrived from nowhere. Deliberately the quietest of the four. */
    .badge--null {
      color: var(--text-mute);
      background: var(--surface-2);
      border-color: var(--border-soft);
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
