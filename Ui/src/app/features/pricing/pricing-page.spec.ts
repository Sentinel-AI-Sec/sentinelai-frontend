import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
    const team = PLANS.find((plan) => plan.id === 'team')!;
    const saving = annualSavingPercent(team);

    expect(saving).toBe(
      Math.round(((team.monthly.amount! - team.annual.amount!) / team.monthly.amount!) * 100),
    );
    expect(render().componentInstance.annualSaving()).toBe(saving);
  });

  it('switches the displayed price with the billing period', () => {
    const page = render().componentInstance;
    const team = PLANS.find((plan) => plan.id === 'team')!;

    page.setPeriod('monthly');
    expect(page.price(team).amount).toBe(priceFor(team, 'monthly').amount);

    page.setPeriod('annual');
    expect(page.price(team).amount).toBe(priceFor(team, 'annual').amount);
  });

  it('treats a plan with an empty Stripe price id as unbuyable', () => {
    for (const plan of PLANS) {
      expect(isPurchasable(plan, 'monthly')).toBe(false);
      expect(isPurchasable(plan, 'annual')).toBe(false);
    }
  });
});
