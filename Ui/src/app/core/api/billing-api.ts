import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';

import { environment } from '../config/environment';
import { ResponseEnvelope } from './wire';

/**
 * Billing, against Stripe — through our own API, never from the browser.
 *
 * These endpoints are implemented (`SentinelAI.Api/Controllers/BillingController.cs`). Every
 * method is still guarded on {@link environment.billing}`.enabled`, which now means "this
 * deployment has a Stripe account configured" rather than "the backend has not been written
 * yet": with it off, each call fails immediately with {@link BillingNotConfiguredError} rather
 * than issuing a request the API would answer `503`. The screens render the same honest
 * not-configured state either way; the flag saves a round trip and keeps the offline demo silent.
 *
 * <h3>Why Checkout and not Stripe.js</h3>
 *
 * The browser never sees a card number, a Stripe key, or a payment method id. It asks our API
 * for a Checkout Session and follows the redirect to a Stripe-hosted page; Stripe redirects
 * back afterwards. That keeps this origin out of PCI scope entirely and means a compromised
 * frontend bundle cannot leak payment data, because it never has any. The cost is a redirect,
 * which is the right trade for a security product.
 *
 * <h3>The four endpoints</h3>
 *
 * <pre>
 * GET  /v1/billing/subscription   → SubscriptionView   what this tenant is on now
 * POST /v1/billing/checkout       → { url }            start a Checkout Session
 * POST /v1/billing/portal         → { url }            open Stripe's billing portal
 * POST /v1/billing/webhook        (Stripe → us)        the only thing that may change state
 * </pre>
 *
 * The webhook is not called from here and never will be. It is listed because it is the half
 * that matters: <b>a successful redirect back from Checkout is not proof of payment.</b> The
 * browser can be sent to the success URL by anyone typing it. Only the signed
 * `checkout.session.completed` webhook may promote a tenant's plan, and the screens here treat
 * the redirect purely as a cue to re-read {@link getSubscription}.
 *
 * Responses ride in the same `Response` envelope the rest of the write API uses
 * (`statusCode`/`isSuccess`/`data`/`message`) — see {@link ResponseEnvelope} — with snake_case
 * fields inside it, matching the SEC-40 reads. That mismatch is inherited from the two
 * conventions either side of it, not chosen here.
 */

/** Where a tenant's subscription actually stands. Mirrors Stripe's own vocabulary. */
export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface SubscriptionView {
  /** The plan id from `core/billing/plans.ts`, or null when the tenant is on nothing paid. */
  plan_id: string | null;
  status: SubscriptionStatus;
  /** Which cadence they bought, when they bought one. */
  period: 'monthly' | 'annual' | null;
  /** Seats paid for. */
  quantity: number;
  /** ISO. When the current period ends — the renewal date, or the cut-off if cancelling. */
  current_period_end: string | null;
  /** True when they have asked to stop at the end of the paid period. */
  cancel_at_period_end: boolean;
  /** ISO. Null unless `status` is `trialing`. */
  trial_end: string | null;
}

/** What a session-creating endpoint returns: somewhere to send the browser. */
export interface HostedSession {
  url: string;
}

/**
 * Thrown when a billing action is attempted before Stripe is wired up.
 *
 * A named error rather than a generic one so the screens can tell "we have not built this yet"
 * apart from "Stripe said no", and show the honest message for each.
 */
export class BillingNotConfiguredError extends Error {
  constructor() {
    super('Billing is not configured for this deployment yet.');
    this.name = 'BillingNotConfiguredError';
  }
}

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** Whether the billing endpoints are expected to exist. */
  get enabled(): boolean {
    return environment.billing.enabled;
  }

  /**
   * What this tenant is on. The tenant comes from the token, never from a parameter — the same
   * rule the rest of the API follows, and the reason a caller cannot ask about someone else's
   * subscription.
   */
  getSubscription(): Observable<SubscriptionView> {
    if (!this.enabled) return throwError(() => new BillingNotConfiguredError());

    return this.http
      .get<ResponseEnvelope<SubscriptionView>>(`${this.base}/v1/billing/subscription`)
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Creates a Stripe Checkout Session and returns the URL to send the browser to.
   *
   * A plan id and a period are sent, never a Stripe Price id. An earlier draft sent the price
   * and expected the backend to check it against an allow-list; passing the plan removes that
   * check rather than performing it, because there is no longer an attacker-supplied identifier
   * to validate. The only thing that can reach Stripe is a price the deployment wrote into its
   * own configuration. It also stops this bundle and the server holding two copies of the same
   * price table — see `core/billing/plans.ts`.
   */
  startCheckout(
    planId: string,
    period: 'monthly' | 'annual',
    quantity = 1,
  ): Observable<HostedSession> {
    if (!this.enabled) return throwError(() => new BillingNotConfiguredError());

    return this.http
      .post<ResponseEnvelope<HostedSession>>(`${this.base}/v1/billing/checkout`, {
        planId,
        period,
        quantity,
        // Where Stripe sends the browser afterwards. Sent by the client so the redirect lands
        // back on the origin the customer actually started from, which differs between local
        // development and the deployed app. The backend accepts only its own configured origins
        // here (`Billing:AllowedReturnOrigins`, falling back to `Cors:AllowedOrigins`) — an
        // unchecked return URL is an open redirect.
        successUrl: `${window.location.origin}/billing?checkout=success`,
        cancelUrl: `${window.location.origin}/billing?checkout=cancelled`,
      })
      .pipe(map((envelope) => envelope.data));
  }

  /**
   * Opens Stripe's own billing portal, where a customer changes card, downloads invoices and
   * cancels.
   *
   * Deliberately not rebuilt in this app. Invoice history and card management are exactly the
   * screens where a homegrown version is both the most work and the most dangerous, and
   * Stripe's is already compliant, localised and audited.
   */
  openPortal(): Observable<HostedSession> {
    if (!this.enabled) return throwError(() => new BillingNotConfiguredError());

    return this.http
      .post<ResponseEnvelope<HostedSession>>(`${this.base}/v1/billing/portal`, {
        returnUrl: `${window.location.origin}/billing`,
      })
      .pipe(map((envelope) => envelope.data));
  }
}
