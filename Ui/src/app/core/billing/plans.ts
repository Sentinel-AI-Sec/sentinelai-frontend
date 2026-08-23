/**
 * The plan catalogue — the one place a displayed price or a limit is written down.
 *
 * **Stripe is the source of truth for what a customer is actually charged.** The numbers here
 * are what the marketing page *displays*; Stripe's Price object is what the card is billed.
 * They have to be kept in step by hand, so they live in one file rather than being scattered
 * through templates — a price that appears in three templates will eventually disagree with
 * itself, and the copy a customer read is the one they will hold you to.
 *
 * **The limits here are enforced server-side**, by
 * `SentinelAI.Application/Abstractions/Billing/PlanEntitlements.cs`. That file is the authority
 * and this one is the shop window; `PlanEntitlementCatalogTests` pins the numbers on that side so
 * the two drifting apart shows up as a failing test rather than as a customer who read "20 scans a
 * day", paid, and was refused at 10.
 *
 * **There are deliberately no Stripe Price ids here.** An earlier draft carried them, on the
 * grounds that they are public identifiers and safe to commit — which is true, and beside the
 * point. The backend has to hold the same table anyway, because a price id arriving from a
 * browser is an input it must not act on unchecked; holding it in both places means two copies
 * that have to be kept in step by hand, and the failure when they drift is a checkout that
 * charges the wrong amount. So `POST /v1/billing/checkout` takes a plan id and a period — the
 * two values below — and resolves the price against its own configuration. See
 * `SentinelAI.Application/Abstractions/Billing/PlanCatalog.cs`.
 */

/** Which cadence a customer is buying. Stripe needs a distinct Price object for each. */
export type BillingPeriod = 'monthly' | 'annual';

/** How a plan's call to action behaves. */
export type PlanAction =
  /** Free — no Stripe involvement; the account already has it on sign-up. */
  | 'included'
  /** Paid — starts a Stripe Checkout Session for {@link Plan.id} at the chosen period. */
  | 'checkout'
  /** Priced by conversation, not by card. */
  | 'contact';

/** The plan ids, matching `PlanEntitlementCatalog` on the server. */
export type PlanId = 'free' | 'pro' | 'max' | 'team' | 'enterprise';

export interface PlanPrice {
  /** Display amount per seat per month, in {@link Plan.currency}. Null for "Custom". */
  amount: number | null;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** One line on who it is for. */
  blurb: string;
  currency: string;
  monthly: PlanPrice;
  annual: PlanPrice;
  action: PlanAction;
  cta: string;

  /**
   * Scans per day this plan allows. Null means unlimited.
   *
   * Held as a number rather than only as prose in {@link features}, because the billing screen
   * shows usage against it — "1 of 2 scans used today" — and a limit parsed back out of a
   * sentence is a limit that breaks when the sentence is reworded.
   */
  scansPerDay: number | null;

  /** Seats included before any more are bought. */
  seats: number;

  /** Whether the plan is sold per seat, which changes how the price reads. */
  perSeat?: boolean;

  /** Rendered with a tick. */
  features: string[];

  /**
   * Rendered with a cross, and deliberately so. A pricing table that only lists what a tier
   * *has* makes every tier look complete; naming the ceiling is what makes the tier above it
   * an honest offer rather than an upsell.
   */
  limits?: string[];

  /** The one tier the table recommends. Exactly one, or none. */
  featured?: boolean;
}

/**
 * Percentage saved by paying annually, used for the toggle's badge.
 *
 * Derived rather than written down: a hardcoded "save 20%" beside prices that no longer divide
 * that way is the classic pricing-page lie, and it is the kind nobody notices for months.
 */
export function annualSavingPercent(plan: Plan): number | null {
  const monthly = plan.monthly.amount;
  const annual = plan.annual.amount;
  if (monthly == null || annual == null || monthly <= 0) return null;
  return Math.round(((monthly - annual) / monthly) * 100);
}

export function priceFor(plan: Plan, period: BillingPeriod): PlanPrice {
  return period === 'annual' ? plan.annual : plan.monthly;
}

/**
 * Whether this plan is one the checkout flow can start at all.
 *
 * Only ever answers what is true on this side: Enterprise is sold by conversation, and the free
 * tier is already included. Whether the deployment actually *sells* this plan at this cadence is
 * the backend's answer — it holds the price table — and the honest way to find out is to ask,
 * which is why an unsold plan comes back as a `400` with a reason rather than as a button that
 * was greyed out on a guess.
 */
export function isPurchasable(plan: Plan, period: BillingPeriod): boolean {
  return plan.action === 'checkout' && priceFor(plan, period).amount !== null;
}

/**
 * The saving a customer is guaranteed on any paid plan, for the annual toggle's badge.
 *
 * The *smallest* of the per-plan savings, not the largest. With one paid tier the two were the
 * same number and the distinction did not arise; with three they differ, and a badge showing the
 * best of them is a promise that two thirds of the table does not keep. Understating is the only
 * direction that is true of every row it sits above.
 */
export function guaranteedAnnualSaving(): number | null {
  const savings = PLANS.map(annualSavingPercent).filter((p): p is number => p != null && p > 0);
  return savings.length > 0 ? Math.min(...savings) : null;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    name: 'Free',
    blurb: 'For trying SentinelAI on a single repository.',
    currency: 'USD',
    monthly: { amount: 0 },
    annual: { amount: 0 },
    action: 'included',
    cta: 'Included with your account',
    scansPerDay: 2,
    seats: 1,
    features: [
      '2 scans per day',
      '1 repository',
      'Dependency, code and IaC findings',
      'Findings and resource graph per scan',
      'Draft audits retained for 7 days',
    ],
    // The free tier's ceiling is the product's whole thesis, so it is named rather than implied:
    // without the debate there are candidate chains and no adjudication of them.
    limits: ['No Red/Blue debate — chains are not adjudicated'],
  },
  {
    id: 'pro',
    name: 'Pro',
    blurb: 'For a developer securing their own projects.',
    currency: 'USD',
    // Per month. The annual figure is the monthly-equivalent of the annual price, which is how
    // it is displayed — the customer is charged 12x this, once.
    monthly: { amount: 29 },
    annual: { amount: 23 },
    action: 'checkout',
    cta: 'Upgrade to Pro',
    scansPerDay: 20,
    seats: 1,
    features: [
      '20 scans per day',
      'Up to 5 repositories',
      'Red/Blue/Reporter debate on every scan',
      'Cross-layer exploit chains with confidence tiers',
      'Corpus-cited draft audits',
      'Audits retained for 30 days',
    ],
  },
  {
    id: 'max',
    name: 'Max',
    blurb: 'For heavy CI/CD use across a whole estate.',
    currency: 'USD',
    monthly: { amount: 99 },
    annual: { amount: 79 },
    action: 'checkout',
    cta: 'Upgrade to Max',
    featured: true,
    scansPerDay: 100,
    seats: 1,
    features: [
      '100 scans per day',
      'Unlimited repositories',
      'Priority in the scan queue',
      'Everything in Pro',
      'Audits retained for a year',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    blurb: 'For a security team sharing one estate.',
    currency: 'USD',
    monthly: { amount: 49 },
    annual: { amount: 39 },
    action: 'checkout',
    cta: 'Start with 5 seats',
    scansPerDay: 100,
    seats: 5,
    perSeat: true,
    features: [
      'Everything in Max, per seat',
      '5 seats included, add more at any time',
      'Shared projects and audit history',
      'Role-based access — admin, analyst, viewer',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    blurb: 'For regulated estates and private deployments.',
    currency: 'USD',
    monthly: { amount: null },
    annual: { amount: null },
    action: 'contact',
    cta: 'Talk to us',
    scansPerDay: null,
    seats: 0,
    features: [
      'Unlimited scans',
      'Private or air-gapped deployment',
      'Bring your own model endpoint',
      'SSO and per-tenant retention policy',
      'Named escalation contact',
    ],
  },
];

export function planById(id: string | null | undefined): Plan | null {
  if (id == null) return null;

  const wanted = id.trim().toLowerCase();

  // `developer` is the id the first tier shipped under, before the ladder gained Pro and Max. It
  // is still written on existing tenants and on any subscription created while it was the name,
  // and the server still resolves it — so resolving it here too is what stops those accounts
  // rendering as "no plan" on a screen that is telling them what they pay for.
  const id_ = wanted === 'developer' ? 'free' : wanted;

  return PLANS.find((plan) => plan.id === id_) ?? null;
}
