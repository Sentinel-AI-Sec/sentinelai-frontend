import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Auth } from '../../core/auth/auth';
import { BillingApi } from '../../core/api/billing-api';
import { PLANS, annualSavingPercent, isPurchasable, priceFor } from '../../core/billing/plans';
import { PricingPage } from './pricing-page';

/** Somewhere for the sign-up redirect to land. */
@Component({ template: '' })
class Blank {}

class FakeAuth {
  constructor(private readonly signedIn: boolean) {}
  isAuthenticated() {
    return this.signedIn;
  }
}

describe('PricingPage', () => {
  function render(signedIn = false, billing: Partial<BillingApi> = { enabled: false }) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'register', component: Blank }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: new FakeAuth(signedIn) },
        { provide: BillingApi, useValue: billing },
      ],
    });

    const fixture = TestBed.createComponent(PricingPage);
    fixture.detectChanges();
    return fixture;
  }

  it('renders every plan with its ceiling, not only its features', () => {
    // A table that lists only what each tier includes makes every tier look complete, which
    // makes the tier above it an upsell rather than an answer.
    const text = (render().nativeElement as HTMLElement).textContent ?? '';

    for (const plan of PLANS) expect(text).toContain(plan.name);
    expect(text).toContain('No Red/Blue debate');
  });

  it('says billing is unconfigured instead of offering a purchase that cannot complete', () => {
    const fixture = render(true, { enabled: false });
    const page = fixture.componentInstance;
    const team = PLANS.find((plan) => plan.id === 'team')!;

    expect(page.blockedReason(team)).toContain('not configured');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('no card will be asked for');
  });

  it('sends a signed-out visitor to register rather than to Stripe', () => {
    // A subscription belongs to a tenant, and a tenant only exists after registration — so
    // there is nothing to attach a payment to yet.
    const startCheckout = vi.fn();
    const fixture = render(false, { enabled: true, startCheckout });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');

    const team = PLANS.find((plan) => plan.id === 'team')!;
    fixture.componentInstance.choose(team);

    expect(startCheckout).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/register'], { queryParams: { plan: 'team' } });
  });

  it('never starts checkout for the contact-us tier', () => {
    const startCheckout = vi.fn();
    const fixture = render(true, { enabled: true, startCheckout });

    fixture.componentInstance.choose(PLANS.find((plan) => plan.id === 'enterprise')!);

    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('derives the annual saving from the prices instead of asserting one', () => {
    // A hardcoded "save 20%" beside prices that no longer divide that way is the classic
    // pricing-page lie, and it is the kind nobody notices for months.
    const savings = PLANS.map(annualSavingPercent).filter(
      (saving): saving is number => saving != null && saving > 0,
    );

    // The smallest, not the largest: the badge sits above every row, so it has to be true of
    // every row. With one paid tier these were the same number; with three they are not.
    expect(render().componentInstance.annualSaving()).toBe(Math.min(...savings));
  });

  it('switches the displayed price with the billing period', () => {
    const page = render().componentInstance;
    const team = PLANS.find((plan) => plan.id === 'team')!;

    page.setPeriod('monthly');
    expect(page.price(team).amount).toBe(priceFor(team, 'monthly').amount);

    page.setPeriod('annual');
    expect(page.price(team).amount).toBe(priceFor(team, 'annual').amount);
  });

  it('offers checkout only for the tiers that have a listed price', () => {
    // Enterprise is priced by conversation and Free comes with the account, so neither is
    // something this flow can start. Whether the deployment actually sells a given tier at a
    // given cadence is the API's answer, not this bundle's — it holds the price table.
    const notSoldHere = ['free', 'enterprise'];

    for (const plan of PLANS) {
      const buyable = !notSoldHere.includes(plan.id);
      expect(isPurchasable(plan, 'monthly')).toBe(buyable);
      expect(isPurchasable(plan, 'annual')).toBe(buyable);
    }
  });

  it('checks out by plan and period, never by Stripe price id', () => {
    // The price id is deliberately not in this bundle: sending one would make it an input the
    // API has to distrust and validate, and would put a second copy of the price table in the
    // browser to drift from the server's.
    // NEVER, not of(...): a session that resolves would have the component call
    // window.location.assign, which jsdom cannot do. The call being asserted happens before the
    // observable emits anything.
    const startCheckout = vi.fn(() => NEVER);
    const fixture = render(true, { enabled: true, startCheckout });
    const page = fixture.componentInstance;

    page.setPeriod('monthly');
    page.choose(PLANS.find((plan) => plan.id === 'team')!);

    expect(startCheckout).toHaveBeenCalledWith('team', 'monthly');
  });

  it('shows the reason the API gave rather than a generic failure', () => {
    // "starting a subscription requires the admin role" is something the reader can act on;
    // "could not start checkout" sends an analyst to raise a ticket about a working system.
    const startCheckout = vi.fn(() =>
      throwError(() => ({ status: 403, error: { message: 'starting a subscription requires the admin role' } })),
    );
    const fixture = render(true, { enabled: true, startCheckout });
    const page = fixture.componentInstance;

    page.choose(PLANS.find((plan) => plan.id === 'team')!);

    expect(page.error()).toContain('requires the admin role');

    // And the reassurance survives, because it is the first thing anyone wants when a payment
    // button fails.
    expect(page.error()).toContain('Nothing has been charged');
  });
});
