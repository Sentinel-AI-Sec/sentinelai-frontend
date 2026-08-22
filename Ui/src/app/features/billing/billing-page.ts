import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import {
  BillingApi,
  BillingNotConfiguredError,
  SubscriptionStatus,
  SubscriptionView,
} from '../../core/api/billing-api';
import {
  CHECKOUT_FAILED,
  NOTHING_CHARGED,
  PORTAL_FAILED,
  billingErrorMessage,
  statusOf,
} from '../../core/billing/checkout-error';
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
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);

  /**
   * How many times to re-read after returning from Stripe, and how long to wait between tries.
   *
   * Stripe redirects the browser the instant the payment is taken. The
   * `checkout.session.completed` webhook that actually promotes the plan is a separate connection
   * to our API and routinely lands after. Reading once therefore shows the *old* plan underneath
   * a green "Payment submitted" banner, and the customer has to work out for themselves that a
   * refresh fixes it.
   *
   * Ten tries at two seconds covers the webhook's normal latency with room to spare. After that
   * the page stops and says so, because at that point a spinner is no longer an honest
   * description of what is happening.
   */
  private static readonly CONFIRM_ATTEMPTS = 10;
  private static readonly CONFIRM_INTERVAL_MS = 2000;

  /** Bound from `?checkout=` — `success` or `cancelled` when Stripe has just sent us back. */
  readonly checkout = input<string>();

  readonly plans = PLANS;
  readonly period = signal<BillingPeriod>('annual');

  /**
   * Seats to buy. Team is priced per seat, so this is what the customer is actually charged for.
   *
   * Defaulted from what they already pay for once the subscription has been read — switching
   * cadence on a nine-seat team should not quietly re-buy one seat.
   */
  readonly seats = signal(1);

  /** True while re-reading after a checkout, waiting for the webhook to land. */
  readonly confirming = signal(false);

  /**
   * Set when the confirmation window closed with the plan still unchanged.
   *
   * Deliberately not an error. The payment may well have succeeded and the webhook may still be
   * in flight; this says what is actually known, which is "we have not seen it yet".
   */
  readonly confirmationTimedOut = signal(false);

  /**
   * Money actions change what the organisation is, not what it has looked at, so they follow the
   * same admin rule as registering a project or deleting the account — and the same rule the API
   * enforces, which would otherwise hand an analyst a raw 403.
   */
  readonly isAdmin = computed(() => this.auth.role() === 'admin');

  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  readonly subscription = signal<SubscriptionView | null>(null);
  readonly loading = signal(true);
  /** Set when billing has not been wired up yet — a different state from a failed request. */
  readonly notConfigured = signal(false);
  readonly error = signal<string | null>(null);

  readonly working = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopConfirming());

    effect(() => {
      // Re-read whenever we come back from Stripe, so a completed webhook is picked up without
      // the customer having to reload.
      const checkout = this.checkout();
      untracked(() => this.load(checkout === 'success'));
    });
  }

  /** The plan the tenant is on. Null resolves to the free tier, which is what an account starts on. */
  /**
   * True when this deployment simulates payments rather than taking them.
   *
   * Shown on the page rather than left to a log line: a customer -- or a demo audience -- looking
   * at an "active" subscription is entitled to know whether any money moved.
   */
  readonly simulated = computed(() => this.subscription()?.provider === 'simulated');

  readonly currentPlan = computed<Plan | null>(() => {
    const sub = this.subscription();
    if (!sub) return null;
    return planById(sub.plan_id) ?? planById('free');
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

  /**
   * Reads the subscription. When `awaitConfirmation` is set — we have just come back from a
   * completed Checkout — keeps re-reading until the plan changes or the window closes.
   */
  load(awaitConfirmation = false): void {
    this.loading.set(true);
    this.error.set(null);
    this.notConfigured.set(false);
    this.confirmationTimedOut.set(false);

    this.api.getSubscription().subscribe({
      next: (subscription) => {
        this.subscription.set(subscription);
        this.loading.set(false);
        this.syncSeats(subscription);

        if (awaitConfirmation && !this.isConfirmed(subscription)) this.startConfirming();
      },
      error: (err: unknown) => {
        this.loading.set(false);

        // Two ways to learn the same thing, and both have to land in the same state. The local
        // flag is off on a build that was never pointed at a Stripe account; the API answers
        // 503 when it has no keys. A deployment can easily be in the second without the first —
        // the flag ships in the bundle and the keys ship in the environment — and treating that
        // as a read failure would tell a customer their subscription could not be loaded when
        // the truth is that this deployment does not sell anything.
        if (err instanceof BillingNotConfiguredError || statusOf(err) === 503) {
          this.notConfigured.set(true);
          return;
        }

        this.error.set('Could not read this organisation’s subscription.');
      },
    });
  }

  /**
   * Whether this subscription reflects a completed purchase.
   *
   * `none` is what an account that has never bought anything reads as, and it is also what the
   * row still says in the gap between Stripe redirecting the browser and the webhook arriving.
   * Anything else means the webhook has been and gone.
   */
  private isConfirmed(subscription: SubscriptionView): boolean {
    return subscription.status !== 'none';
  }

  /** Polls the subscription until the webhook lands or the attempts run out. */
  private startConfirming(attempt = 0): void {
    if (attempt >= BillingPage.CONFIRM_ATTEMPTS) {
      this.confirming.set(false);
      this.confirmationTimedOut.set(true);
      return;
    }

    this.confirming.set(true);

    this.confirmTimer = setTimeout(() => {
      this.api.getSubscription().subscribe({
        next: (subscription) => {
          this.subscription.set(subscription);
          this.syncSeats(subscription);

          if (this.isConfirmed(subscription)) {
            this.confirming.set(false);
            // The banner has done its job. Leaving `?checkout=success` on the URL means a
            // refresh, a bookmark or a shared link re-announces a payment that finished long ago.
            void this.router.navigate([], { queryParams: {}, replaceUrl: true });
            return;
          }

          this.startConfirming(attempt + 1);
        },
        // A failed read mid-poll is not fatal: the next tick may well succeed, and the plan
        // itself is unaffected either way.
        error: () => this.startConfirming(attempt + 1),
      });
    }, BillingPage.CONFIRM_INTERVAL_MS);
  }

  private stopConfirming(): void {
    if (this.confirmTimer !== null) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
    this.confirming.set(false);
  }

  /** Keeps the seat picker showing what the tenant already pays for. */
  private syncSeats(subscription: SubscriptionView): void {
    if (subscription.quantity > 0) this.seats.set(subscription.quantity);
  }

  setSeats(value: number): void {
    // Clamped rather than validated-and-rejected: a seat stepper that refuses to move is worse
    // than one that stops at the end. The API bounds it again, because a number from a browser is
    // an input wherever it arrives.
    this.seats.set(Math.max(1, Math.min(500, Math.floor(value) || 1)));
  }

  /** Reads a seat count out of the number input without trusting it. */
  onSeatsInput(event: Event): void {
    this.setSeats(Number((event.target as HTMLInputElement).value));
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
    if (this.working() || !this.purchasable(plan) || !this.isAdmin()) return;

    this.actionError.set(null);
    this.working.set(plan.id);

    // The seat count is passed explicitly. `startCheckout` has always accepted one and defaulted
    // it to 1, so every purchase of a per-seat plan bought a single seat regardless of the size
    // of the team doing the buying.
    this.api.startCheckout(plan.id, this.period(), this.seats()).subscribe({
      next: (session) => window.location.assign(session.url),
      error: (err: unknown) => {
        this.working.set(null);
        this.actionError.set(billingErrorMessage(err, CHECKOUT_FAILED, NOTHING_CHARGED));
      },
    });
  }

  /** Hands off to Stripe for card changes, invoices and cancellation. */
  openPortal(): void {
    if (this.working() || !this.isAdmin()) return;

    this.actionError.set(null);
    this.working.set('portal');

    this.api.openPortal().subscribe({
      next: (session) => window.location.assign(session.url),
      error: (err: unknown) => {
        this.working.set(null);
        this.actionError.set(billingErrorMessage(err, PORTAL_FAILED));
      },
    });
  }
}
