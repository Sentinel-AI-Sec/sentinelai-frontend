import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { BillingApi } from '../../core/api/billing-api';
import {
  BillingPeriod,
  Plan,
  PLANS,
  annualSavingPercent,
  isPurchasable,
  priceFor,
} from '../../core/billing/plans';

/** One question and its answer. Kept beside the plans because it is where they get asked. */
interface Faq {
  q: string;
  a: string;
}

/**
 * Plans and prices — the one screen in the app a signed-out visitor can read.
 *
 * Two rules it shares with the rest of the console.
 *
 * **It does not claim what the product cannot do.** Every feature bullet in
 * `core/billing/plans.ts` names something the pipeline actually produces, and the Developer
 * tier states its ceiling — no debate, so no adjudicated chains — rather than listing only what
 * it includes. A pricing table that reads as complete at every tier is selling the tier above it
 * dishonestly.
 *
 * **It does not pretend to take money.** While `environment.billing.enabled` is false the plans
 * still render in full, and the buy action says billing is not configured yet instead of
 * starting a flow that cannot finish. Nothing here mocks a successful payment.
 */
@Component({
  selector: 'app-pricing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './pricing-page.html',
  styleUrl: './pricing-page.css',
})
export class PricingPage {
  private readonly billing = inject(BillingApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);

  readonly plans = PLANS;
  readonly period = signal<BillingPeriod>('annual');
  readonly openFaq = signal<number | null>(0);

  /** Set while a Checkout Session is being created, so the button cannot be pressed twice. */
  readonly starting = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly billingEnabled = this.billing.enabled;

  /**
   * The saving shown on the annual toggle, taken from whichever plan actually has both prices.
   * Computed rather than written down so it cannot drift away from the numbers beside it.
   */
  readonly annualSaving = computed(() => {
    for (const plan of this.plans) {
      const saving = annualSavingPercent(plan);
      if (saving != null && saving > 0) return saving;
    }
    return null;
  });

  readonly faqs: Faq[] = [
    {
      q: 'How is this different from the scanners we already run?',
      a:
        'It does not replace them — it consumes them. You upload what Trivy, OSV, Checkov and ' +
        'the Roslyn analysers already found, and SentinelAI joins those findings across code, ' +
        'dependencies and infrastructure into a graph, then argues over which paths through it ' +
        'actually reach something worth protecting. The output is a handful of ordered chains ' +
        'rather than a few thousand isolated alerts.',
    },
    {
      q: 'Does it prove an exploit works?',
      a:
        'No, and it says so on every report. What it produces is a draft audit: candidate ' +
        'chains that exist in your resource graph, argued over by a Red/Blue/Reporter debate, ' +
        'with a confidence tier on every join. Nothing is executed against your infrastructure ' +
        'at any point. A chain resting on a naming convention is labelled inferred, not certain, ' +
        'and one the evidence cannot settle is labelled unresolved rather than quietly dropped.',
    },
    {
      q: 'How long does a scan take?',
      a:
        'Ingest, normalisation and graph building are fast — seconds. The debate is not: it is ' +
        'four to seven sequential model calls and takes a minute or two, which is why it runs ' +
        'asynchronously and reports back rather than blocking your pipeline. You get the ' +
        'findings and the graph immediately and the adjudicated chains when the debate lands.',
    },
    {
      q: 'Where does our code go?',
      a:
        'The bundle you upload is scanner output and manifests, not your source tree. Secrets ' +
        'are redacted at ingress before any model sees the text, and the stored bundle is ' +
        'purged once the audit is written — the provenance record outlives it, so the hash and ' +
        'manifest stay auditable after the material is gone. Enterprise deployments can run the ' +
        'whole pipeline against a model endpoint you control.',
    },
    {
      q: 'Can we change or cancel later?',
      a:
        'Yes, from the billing screen, which hands you Stripe’s own portal. Cancelling stops the ' +
        'renewal and leaves the plan active until the period you have already paid for ends.',
    },
  ];

  price(plan: Plan) {
    return priceFor(plan, this.period());
  }

  purchasable(plan: Plan): boolean {
    return isPurchasable(plan, this.period());
  }

  setPeriod(period: BillingPeriod): void {
    this.period.set(period);
  }

  toggleFaq(index: number): void {
    this.openFaq.update((open) => (open === index ? null : index));
  }

  /**
   * Why a plan's button is disabled, or null when it is not.
   *
   * Returned as a sentence rather than a boolean because "you cannot click this" is useless on
   * its own — every reason here is something the visitor can act on.
   */
  blockedReason(plan: Plan): string | null {
    if (plan.action !== 'checkout') return null;
    if (!this.billingEnabled) return 'Billing is not configured on this deployment yet.';
    if (!this.purchasable(plan)) return 'This plan has no price configured yet.';
    return null;
  }

  /**
   * Starts Checkout, or sends an unauthenticated visitor to sign up first.
   *
   * The subscription belongs to a tenant, and a tenant only exists after registration — so
   * there is nothing to attach a payment to before then. Sending them to `/register` with the
   * plan in the query string means they land back here having chosen it.
   */
  choose(plan: Plan): void {
    this.error.set(null);

    if (plan.action === 'contact') return;

    if (!this.auth.isAuthenticated()) {
      void this.router.navigate(['/register'], { queryParams: { plan: plan.id } });
      return;
    }

    if (this.blockedReason(plan) || this.starting()) return;

    this.starting.set(plan.id);

    this.billing.startCheckout(this.price(plan).priceId).subscribe({
      next: (session) => {
        // Leaving the app entirely: Stripe hosts the card form, we never see it.
        window.location.assign(session.url);
      },
      error: () => {
        this.starting.set(null);
        this.error.set('Could not start checkout. Nothing has been charged — please try again.');
      },
    });
  }
}
