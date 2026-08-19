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
    // The endpoints do not exist yet. Issuing the request anyway would surface a 404 that reads
    // like a backend fault, when the honest answer is "this deployment has no Stripe behind it".
    const { api, http } = setup(false);

    const calls: (() => Observable<unknown>)[] = [
      () => api.getSubscription(),
      () => api.startCheckout('price_123'),
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

  it('sends the price id and same-origin return URLs when starting checkout', async () => {
    // The return URLs are sent by the client so the redirect lands back where the customer
    // started. The backend still has to check them against its own allow-list — an unchecked
    // return URL is an open redirect — but that is its job, not something this test can assert.
    const { api, http } = setup(true);

    const result = new Promise((resolve) => api.startCheckout('price_team_annual', 4).subscribe(resolve));

    const request = http.expectOne('/v1/billing/checkout');
    expect(request.request.body.priceId).toBe('price_team_annual');
    expect(request.request.body.quantity).toBe(4);
    expect(request.request.body.successUrl).toContain('/billing?checkout=success');
    expect(request.request.body.cancelUrl).toContain('/billing?checkout=cancelled');

    request.flush({ statusCode: 200, isSuccess: true, message: 'ok', data: { url: 'https://checkout.stripe.com/x' } });
    expect(await result).toEqual({ url: 'https://checkout.stripe.com/x' });
    http.verify();
  });
});
