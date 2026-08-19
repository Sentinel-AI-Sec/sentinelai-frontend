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
 * reading is one that was not really shown. It is also the one panel that keeps its full
 * contrast when the page is printed — a chain pasted into a ticket has to arrive with this
 * attached.
 */
@Component({
  selector: 'app-draft-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="banner" role="note">
      <span class="banner__icon ms ms--lg" aria-hidden="true">gavel</span>

      <div class="banner__body">
        <span class="tag">Draft audit</span>
        <p>
          For human review — not a verdict. Every chain below is a path that
          <strong>exists in the resource graph</strong>, argued over by the Red/Blue debate. None
          of them is an exploit that was executed or proven. Check the confidence tier on each
          join before acting.
        </p>
      </div>
    </aside>
  `,
  styles: `
    .banner {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      padding: 1.1rem 1.25rem;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, rgba(128, 131, 255, 0.16), rgba(28, 26, 41, 0.9));
      border: 1px solid rgba(128, 131, 255, 0.4);
      border-left-width: 3px;
      box-shadow: var(--shadow-sm);
    }

    .banner__icon {
      color: var(--accent-soft);
      margin-top: 0.1rem;
    }

    .banner__body {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
      min-width: 0;
    }

    .tag {
      padding: 0.15rem 0.6rem;
      border-radius: var(--radius-pill);
      background: var(--accent);
      color: var(--on-accent);
      font-family: var(--mono);
      font-size: 0.64rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    p {
      margin: 0;
      font-size: 0.86rem;
      line-height: 1.6;
      color: var(--text-dim);
      max-width: 76ch;
    }

    strong {
      color: var(--text);
      font-weight: 650;
    }

    @media print {
      .banner {
        background: none;
        border-color: #000;
      }
    }
  `,
})
export class DraftBanner {}
