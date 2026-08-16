import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The draft-audit framing (AID-01 §7), stated at the top of every report.
 *
 * A required element, not decoration. What the backend produces is a set of candidate chains
 * that a debate argued over — not a verdict, and not a proven exploit. If the screen presents
 * it as findings-of-fact, the honesty the whole pipeline is built to preserve is thrown away
 * at the last step, which is also the only step a customer actually sees.
 *
 * Placed above the results and not collapsible, because a framing a reader can dismiss before
 * reading is one that was not really shown.
 */
@Component({
  selector: 'app-draft-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="banner" role="note">
      <span class="tag">Draft audit</span>
      <p>
        For human review — not a verdict. Every chain below is a path that
        <strong>exists in the resource graph</strong>, argued over by the Red/Blue debate. None of
        them is an exploit that was executed or proven. Check the confidence tier on each join
        before acting.
      </p>
    </aside>
  `,
  styles: `
    .banner {
      display: flex;
      align-items: flex-start;
      gap: 0.9rem;
      padding: 0.9rem 1.1rem;
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--accent) 8%, var(--surface));
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      border-left-width: 3px;
    }

    .tag {
      flex: none;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: var(--accent);
      color: var(--accent-contrast);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    p {
      margin: 0;
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--text);
    }

    @media (max-width: 640px) {
      .banner {
        flex-direction: column;
        gap: 0.6rem;
      }
    }
  `,
})
export class DraftBanner {}
