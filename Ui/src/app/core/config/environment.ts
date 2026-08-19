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
   * `enabled` is the switch. While it is false the billing screens still render — plans, the
   * comparison, the current-plan panel — but every action that would spend money says plainly
   * that billing is not configured instead of calling an endpoint that does not exist yet.
   * That is the same rule the rest of this app follows: show the real state, never a mock of a
   * successful outcome.
   *
   * To turn it on: implement the four endpoints named in `core/api/billing-api.ts`, put the
   * Stripe **Price** ids into `core/billing/plans.ts` (they are public identifiers, safe to
   * commit), and flip this to true.
   */
  billing: {
    enabled: false,
  },
};
