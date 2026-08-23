import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { BillingApi, BillingNotConfiguredError } from './billing-api';
import { environment } from '../config/environment';

describe('BillingApi', () => {
  function setup(enabled: boolean) {
    environment.billing.enabled = enabled;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      api: TestBed.inject(BillingApi),
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => {
    environment.billing.enabled = false;
  });

  it('refuses every action while billing is unconfigured, without touching the network', async () => {
    // The endpoints exist, but this build has not been pointed at a Stripe account. Issuing the
    // request anyway would surface a 503 the screens have to translate back into the same state
    // — the honest answer is already known here, one round trip earlier.
    const { api, http } = setup(false);

    const calls: (() => Observable<unknown>)[] = [
      () => api.getSubscription(),
      () => api.startCheckout('team', 'monthly'),
      () => api.openPortal(),
    ];

    for (const call of calls) {
      await new Promise<void>((resolve) => {
        call().subscribe({
          error: (err: unknown) => {
            expect(err).toBeInstanceOf(BillingNotConfiguredError);
            resolve();
          },
        });
      });
    }

    http.verify(); // no request was ever made
  });

  it('unwraps the response envelope the write API uses', async () => {
    const { api, http } = setup(true);

    const result = new Promise((resolve) => api.getSubscription().subscribe(resolve));

    http.expectOne('/v1/billing/subscription').flush({
      statusCode: 200,
      isSuccess: true,
      message: 'ok',
      data: {
        plan_id: 'team',
        status: 'active',
        period: 'annual',
        quantity: 3,
        current_period_end: '2027-01-01T00:00:00Z',
        cancel_at_period_end: false,
        trial_end: null,
      },
    });

    expect(await result).toMatchObject({ plan_id: 'team', quantity: 3 });
    http.verify();
  });

  it('sends the plan, the period and same-origin return URLs when starting checkout', async () => {
    // No Stripe price id crosses this boundary, deliberately: one arriving from a browser is an
    // input the API would have to distrust and validate, and holding the price table in the
    // bundle as well as on the server is two copies to keep in step by hand.
    //
    // The return URLs are sent by the client so the redirect lands back where the customer
    // started. The backend still checks them against its own allow-list — an unchecked return
    // URL is an open redirect — but that is its job, not something this test can assert.
    const { api, http } = setup(true);

    const result = new Promise((resolve) =>
      api.startCheckout('team', 'annual', 4).subscribe(resolve),
    );

    const request = http.expectOne('/v1/billing/checkout');
    expect(request.request.body.planId).toBe('team');
    expect(request.request.body.period).toBe('annual');
    expect(request.request.body.priceId).toBeUndefined();
    expect(request.request.body.quantity).toBe(4);
    expect(request.request.body.successUrl).toContain('/billing?checkout=success');
    expect(request.request.body.cancelUrl).toContain('/billing?checkout=cancelled');

    request.flush({ statusCode: 200, isSuccess: true, message: 'ok', data: { url: 'https://checkout.stripe.com/x' } });
    expect(await result).toEqual({ url: 'https://checkout.stripe.com/x' });
    http.verify();
  });
});
