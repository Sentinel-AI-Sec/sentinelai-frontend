import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Auth } from '../../core/auth/auth';
import {
  BillingApi,
  BillingNotConfiguredError,
  SubscriptionView,
} from '../../core/api/billing-api';
import { BillingPage } from './billing-page';

class FakeAuth {
  tenantId() {
    return 'tenant-1';
  }
  role() {
    return 'admin';
  }
  isAuthenticated() {
    return true;
  }
}

const onFree: SubscriptionView = {
  plan_id: null,
  status: 'none',
  period: null,
  quantity: 1,
  current_period_end: null,
  cancel_at_period_end: false,
  trial_end: null,
};

describe('BillingPage', () => {
  function render(api: Partial<BillingApi>, checkout?: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useClass: FakeAuth },
        { provide: BillingApi, useValue: { enabled: true, ...api } },
      ],
    });

    const fixture = TestBed.createComponent(BillingPage);
    if (checkout) fixture.componentRef.setInput('checkout', checkout);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => vi.restoreAllMocks());

  it('does not treat a success redirect as proof of payment', () => {
    // The single most important rule on this screen. Anyone can type ?checkout=success. Only
    // Stripe's signed webhook may move a tenant onto a plan, so the page shows what the backend
    // confirmed — here, still the free tier — and never what the query string implied.
    const fixture = render({ getSubscription: () => of(onFree) }, 'success');
    const page = fixture.componentInstance;

    expect(page.currentPlan()?.id).toBe('developer');
    expect(page.status()).toBe('none');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Payment submitted');
    // It must not claim the upgrade happened.
    expect(text).not.toContain('Switch to Developer');
    expect(text).toContain('Free tier');
  });

  it('re-reads the subscription when Stripe sends the browser back', () => {
    // The webhook may land while the customer is still on Stripe's page, so returning has to
    // trigger a fresh read rather than trusting whatever was loaded before leaving.
    const getSubscription = vi.fn(() => of(onFree));
    const fixture = render({ getSubscription }, 'success');

    expect(getSubscription).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('checkout', 'cancelled');
    fixture.detectChanges();

    expect(getSubscription).toHaveBeenCalledTimes(2);
  });

  it('says a cancelled checkout charged nothing', () => {
    const fixture = render({ getSubscription: () => of(onFree) }, 'cancelled');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Nothing has been charged');
  });

  it('separates "not built yet" from "the request failed"', () => {
    const fixture = render({
      getSubscription: () => throwError(() => new BillingNotConfiguredError()),
    });

    expect(fixture.componentInstance.notConfigured()).toBe(true);
    expect(fixture.componentInstance.error()).toBeNull();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Billing is not wired up yet');
  });

  it('shows a lapsed payment as needing action rather than as an active plan', () => {
    const fixture = render({
      getSubscription: () =>
        of({ ...onFree, plan_id: 'team', status: 'past_due' as const, period: 'annual' as const }),
    });

    expect(fixture.componentInstance.statusClass()).toBe('chip--danger');
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'The last payment failed',
    );
  });

  it('reports a cancelled-but-paid subscription as ending, not as already gone', () => {
    // Between cancelling and the period closing the customer still has what they paid for.
    // Rendering that as "Cancelled" would understate the access they still hold.
    const fixture = render({
      getSubscription: () =>
        of({
          ...onFree,
          plan_id: 'team',
          status: 'active' as const,
          period: 'annual' as const,
          cancel_at_period_end: true,
          current_period_end: '2027-03-01T00:00:00Z',
        }),
    });

    expect(fixture.componentInstance.windingDown()).toBe(true);
    expect(fixture.componentInstance.statusLabel()).toContain('ends at period close');
  });

  it('never starts a checkout for a tier that is not sold by card', () => {
    // Enterprise is priced by conversation. Clicking its row must not open Stripe.
    const startCheckout = vi.fn();
    const fixture = render({ getSubscription: () => of(onFree), startCheckout });
    const page = fixture.componentInstance;

    const enterprise = page.plans.find((plan) => plan.id === 'enterprise')!;
    expect(page.purchasable(enterprise)).toBe(false);

    page.choose(enterprise);
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('upgrades by plan and period rather than by Stripe price id', () => {
    const startCheckout = vi.fn(() => NEVER);
    const fixture = render({ getSubscription: () => of(onFree), startCheckout });
    const page = fixture.componentInstance;

    page.setPeriod('annual');
    page.choose(page.plans.find((plan) => plan.id === 'team')!);

    expect(startCheckout).toHaveBeenCalledWith('team', 'annual');
  });

  it('reads a 503 from the API as "not configured", not as a failed read', () => {
    // The local flag ships in the bundle and the Stripe keys ship in the environment, so a
    // deployment is easily in one state and not the other. Reporting "could not read your
    // subscription" for a deployment that simply sells nothing sends someone hunting a fault.
    const fixture = render({
      getSubscription: () => throwError(() => ({ status: 503 })),
    });

    expect(fixture.componentInstance.notConfigured()).toBe(true);
    expect(fixture.componentInstance.error()).toBeNull();
  });

  it('surfaces the API reason when the portal will not open', () => {
    const openPortal = vi.fn(() =>
      throwError(() => ({
        status: 400,
        error: { message: 'this organisation has no billing account yet' },
      })),
    );
    const fixture = render({ getSubscription: () => of(onFree), openPortal });
    const page = fixture.componentInstance;

    page.openPortal();

    expect(page.actionError()).toContain('no billing account yet');

    // No reassurance about charges here: opening a portal is not a payment, and volunteering
    // that nothing was charged invites the reader to wonder whether something might have been.
    expect(page.actionError()).not.toContain('Nothing has been charged');
  });
});
