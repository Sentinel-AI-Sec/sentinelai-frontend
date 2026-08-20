/**
 * Runtime configuration for the read-only report UI (SEC-42).
 *
 * `apiBaseUrl` is empty on purpose: requests go to same-origin `/v1/...` and the Angular dev
 * proxy (proxy.conf.json) forwards them to the backend — currently the deployed Azure Container
 * Apps instance. That keeps the JWT out of a cross-origin request in development, and means the
 * API needs no CORS configuration for us.
 */
export const environment = {
  /** Same-origin by default; set to an absolute URL only for a deployed split-host setup. */
  apiBaseUrl: '',

  /**
   * Serve the reference fixture's audit instead of calling the backend.
   *
   * The screen stays demoable and testable without a running API, a database, or a scanned
   * repository — which is what makes it reviewable before the pipeline is wired end to end.
   * Flip this to true (no other changes needed) if you need to demo the UI without the API
   * running — the demo source returns the exact wire shapes the API sends.
   */
  useDemoData: false,

  /**
   * Billing, via Stripe Checkout.
   *
   * **Nothing secret belongs here.** The integration is deliberately shaped so the browser
   * never sees a Stripe key and never touches a card number: the frontend asks our own API to
   * create a Checkout Session, the API talks to Stripe with the secret key server-side, and the
   * browser is redirected to a Stripe-hosted page. Card data never enters this origin, which
   * keeps the whole app out of PCI scope. A `publishableKey` field is absent on purpose —
   * Checkout does not need one, and adding it would invite someone to reach for Stripe.js and
   * mount a card field here.
   *
   * `enabled` is the switch, and it now means "point this build at the billing API" rather than
   * "the backend has been written". The four endpoints exist
   * (`SentinelAI.Api/Controllers/BillingController.cs`); what they still need is a Stripe
   * account, which is supplied to the API through `Billing:SecretKey` and
   * `Billing:WebhookSecret` — never through this file, and never through this bundle.
   *
   * With it off, the billing screens still render in full — plans, the comparison, the
   * current-plan panel — and every action that would spend money says plainly that billing is
   * not configured, instead of issuing a request. With it on but the API holding no Stripe keys,
   * the API answers `503` and the screens land in the same honest state. Nothing here ever mocks
   * a successful payment.
   *
   * On for local development, where `ng serve` proxies to an API that answers either way. A
   * deployment that has no Stripe account and wants the flow hidden entirely can turn it off in
   * `environment.prod.ts`.
   *
   * There are no Stripe **Price** ids in this bundle any more — the API resolves a plan id and a
   * period against its own configured price table. See `core/billing/plans.ts`.
   */
  billing: {
    enabled: true,
  },
};
