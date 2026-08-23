import { Environment } from './environment.model';

/**
 * Production build configuration. Swapped in for environment.ts by the
 * `fileReplacements` entry on angular.json's production configuration.
 *
 * `apiBaseUrl` is absolute here, unlike the same-origin default: proxy.conf.json
 * only exists for `ng serve`, so a deployed bundle has nothing forwarding /v1 and
 * must address the backend directly. That makes the call cross-origin, which is
 * why the API carries this host in Cors:AllowedOrigins.
 *
 * **Every key in environment.ts has to exist here.** This file replaces that one
 * wholesale, and TypeScript never compares the two — each is only ever checked
 * against itself — so a key present there and missing here compiles clean and
 * throws at runtime, in the production bundle only. `billing` was exactly that:
 * `BillingApi` reads `environment.billing.enabled` on construction, so a deployed
 * build would have failed on the first billing screen with a TypeError while every
 * local build worked.
 */
export const environment: Environment = {
  apiBaseUrl: 'https://sentinelaiapi-app-20260818105221.orangemeadow-4eb00442.swedencentral.azurecontainerapps.io',

  useDemoData: false,

  /**
   * Billing, via Stripe Checkout. See environment.ts for the full reasoning — in short, nothing
   * secret belongs here, the browser never sees a Stripe key or a card, and this flag only says
   * whether to call the billing endpoints at all.
   *
   * On, because the endpoints exist and the deployed API decides for itself whether it has a
   * Stripe account: with no keys it answers `503` and the screens show the same honest
   * not-configured state this flag would have produced, without the bundle having to be rebuilt
   * to change its mind.
   */
  billing: {
    enabled: true,
  },
};
