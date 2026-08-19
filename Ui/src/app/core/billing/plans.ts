/**
 * The plan catalogue — the one place a price, a limit or a Stripe Price id is written down.
 *
 * **Stripe is the source of truth for what a customer is actually charged.** The numbers here
 * are what the marketing page *displays*; Stripe's Price object is what the card is billed.
 * They have to be kept in step by hand, so they live in one file rather than being scattered
 * through templates — a price that appears in three templates will eventually disagree with
 * itself, and the copy a customer read is the one they will hold you to.
 *
 * `priceId` values are Stripe **Price** ids (`price_...`), not Product ids, and not secrets:
 * they identify a public price and are safe to commit. They are empty until the Stripe account
 * exists. Nothing in the UI guesses one — an empty id disables that plan's action and says why.
 */

/** Which cadence a customer is buying. Stripe needs a distinct Price object for each. */
export type BillingPeriod = 'monthly' | 'annual';

/** How a plan's call to action behaves. */
export type PlanAction =
  /** Free — no Stripe involvement; the account already has it on sign-up. */
  | 'included'
  /** Paid — starts a Stripe Checkout Session against {@link Plan.priceId}. */
  | 'checkout'
  /** Priced by conversation, not by card. */
  | 'contact';

export interface PlanPrice {
  /** Display amount per seat per month, in {@link Plan.currency}. Null for "Custom". */
  amount: number | null;
  /** The Stripe Price id to check out against. Empty until Stripe is configured. */
  priceId: string;
}

export interface Plan {
  id: 'developer' | 'team' | 'enterprise';
  name: string;
  /** One line on who it is for. */
  blurb: string;
  currency: string;
  monthly: PlanPrice;
  annual: PlanPrice;
  action: PlanAction;
  cta: string;
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

/** Whether this plan can actually be bought right now. */
export function isPurchasable(plan: Plan, period: BillingPeriod): boolean {
  return plan.action === 'checkout' && priceFor(plan, period).priceId.trim().length > 0;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'developer',
    name: 'Developer',
    blurb: 'For solo builders and open-source maintainers.',
    currency: 'USD',
    monthly: { amount: 0, priceId: '' },
    annual: { amount: 0, priceId: '' },
    action: 'included',
    cta: 'Included with your account',
    features: [
      'Up to 5 repositories',
      'Dependency, code and IaC findings',
      'Findings and resource graph per scan',
      'Draft audits retained for 30 days',
    ],
    limits: ['No Red/Blue debate — findings are not adjudicated into chains'],
  },
  {
    id: 'team',
    name: 'Team',
    blurb: 'For a security team running SentinelAI across CI/CD.',
    currency: 'USD',
    // Per seat per month. The annual figure is the monthly-equivalent of the annual price,
    // which is how it is displayed — the customer is charged 12x this, once.
    monthly: { amount: 49, priceId: '' },
    annual: { amount: 39, priceId: '' },
    action: 'checkout',
    cta: 'Start 14-day trial',
    featured: true,
    features: [
      'Unlimited repositories and pipelines',
      'Red/Blue/Reporter debate on every scan',
      'Cross-layer exploit chains with confidence tiers',
      'Corpus-cited draft audits',
      'Unlimited audit retention',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    blurb: 'For regulated estates and private deployments.',
    currency: 'USD',
    monthly: { amount: null, priceId: '' },
    annual: { amount: null, priceId: '' },
    action: 'contact',
    cta: 'Talk to us',
    features: [
      'Private or air-gapped deployment',
      'Bring your own model endpoint',
      'SSO and per-tenant retention policy',
      'Named escalation contact',
    ],
  },
];

export function planById(id: string | null | undefined): Plan | null {
  return PLANS.find((plan) => plan.id === id) ?? null;
}
