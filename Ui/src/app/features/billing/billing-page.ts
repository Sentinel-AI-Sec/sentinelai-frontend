import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import {
  BillingApi,
  BillingNotConfiguredError,
  SubscriptionStatus,
  SubscriptionView,
} from '../../core/api/billing-api';
import {
  BillingPeriod,
  Plan,
  PLANS,
  isPurchasable,
  planById,
  priceFor,
} from '../../core/billing/plans';

/**
 * What this tenant is paying for, and how to change it.
 *
 * <h3>The redirect is a cue, not a receipt</h3>
 *
 * Stripe sends the browser back here with `?checkout=success`, and this screen deliberately
 * does <b>not</b> treat that as proof of anything. Anyone can type that URL. What it does is
 * re-read the subscription from our own API, which only moves after Stripe's signed
 * `checkout.session.completed` webhook has been verified server-side. So the success banner
 * says the payment was submitted and the plan will appear once confirmed — and if the read
 * still shows the old plan, that is what is displayed. Showing "you are now on Team" because a
 * query parameter said so is exactly the kind of claim this product exists not to make.
 *
 * <h3>Card details are not here</h3>
 *
 * Changing a card, downloading invoices and cancelling all hand off to Stripe's own portal.
 * That is not laziness: those are the screens where a homegrown version carries the most risk
 * and the least value, and Stripe's is already audited and localised.
 */
@Component({
  selector: 'app-billing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  templateUrl: './billing-page.html',
  styleUrl: './billing-page.css',
})
export class BillingPage {
  private readonly api = inject(BillingApi);
  protected readonly auth = inject(Auth);

  /** Bound from `?checkout=` — `success` or `cancelled` when Stripe has just sent us back. */
  readonly checkout = input<string>();

  readonly plans = PLANS;
  readonly period = signal<BillingPeriod>('annual');

  readonly subscription = signal<SubscriptionView | null>(null);
  readonly loading = signal(true);
  /** Set when billing has not been wired up yet — a different state from a failed request. */
  readonly notConfigured = signal(false);
  readonly error = signal<string | null>(null);

  readonly working = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  constructor() {
    effect(() => {
      // Re-read whenever we come back from Stripe, so a completed webhook is picked up without
      // the customer having to reload.
      this.checkout();
      untracked(() => this.load());
    });
  }

  /** The plan the tenant is on. Null resolves to the free tier, which is what an account starts on. */
  readonly currentPlan = computed<Plan | null>(() => {
    const sub = this.subscription();
    if (!sub) return null;
    return planById(sub.plan_id) ?? planById('developer');
  });

  readonly status = computed<SubscriptionStatus>(() => this.subscription()?.status ?? 'none');

  /** True while the customer has paid for a period that has not ended yet, despite cancelling. */
  readonly windingDown = computed(() => this.subscription()?.cancel_at_period_end === true);

  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'trialing':
        return 'Trial';
      case 'active':
        return this.windingDown() ? 'Active — ends at period close' : 'Active';
      case 'past_due':
        return 'Payment failed';
      case 'canceled':
        return 'Cancelled';
      case 'incomplete':
        return 'Awaiting payment confirmation';
      default:
        return 'Free tier';
    }
  });

  readonly statusClass = computed(() => {
    switch (this.status()) {
      case 'active':
        return this.windingDown() ? 'chip--warn' : 'chip--ok';
      case 'trialing':
        return 'chip--accent';
      case 'past_due':
        return 'chip--danger';
      case 'incomplete':
        return 'chip--warn';
      default:
        return 'chip--mute';
    }
  });

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.notConfigured.set(false);

    this.api.getSubscription().subscribe({
      next: (subscription) => {
        this.subscription.set(subscription);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        if (err instanceof BillingNotConfiguredError) {
          this.notConfigured.set(true);
          return;
        }
        this.error.set('Could not read this organisation’s subscription.');
      },
    });
  }

  price(plan: Plan) {
    return priceFor(plan, this.period());
  }

  purchasable(plan: Plan): boolean {
    return isPurchasable(plan, this.period());
  }

  setPeriod(period: BillingPeriod): void {
    this.period.set(period);
  }

  isCurrent(plan: Plan): boolean {
    return this.currentPlan()?.id === plan.id;
  }

  /** Upgrades or switches cadence by starting a fresh Checkout Session. */
  choose(plan: Plan): void {
    if (this.working() || !this.purchasable(plan)) return;

    this.actionError.set(null);
    this.working.set(plan.id);

    this.api.startCheckout(this.price(plan).priceId).subscribe({
      next: (session) => window.location.assign(session.url),
      error: () => {
        this.working.set(null);
        this.actionError.set(
          'Could not start checkout. Nothing has been charged — please try again.',
        );
      },
    });
  }

  /** Hands off to Stripe for card changes, invoices and cancellation. */
  openPortal(): void {
    if (this.working()) return;

    this.actionError.set(null);
    this.working.set('portal');

    this.api.openPortal().subscribe({
      next: (session) => window.location.assign(session.url),
      error: () => {
        this.working.set(null);
        this.actionError.set('Could not open the billing portal. Please try again.');
      },
    });
  }
}
