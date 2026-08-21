/**
 * The shape both environment files have to satisfy.
 *
 * `environment.prod.ts` had already drifted once: it defined `apiBaseUrl` and `useDemoData` and no
 * `billing` key at all, while `angular.json` replaces `environment.ts` with it under the
 * `production` configuration — which is the *default* for `ng build`. Every production bundle
 * therefore shipped an `environment` with no `billing`, and `BillingApi` read `.enabled` off
 * `undefined` on construction.
 *
 * That crashed `/pricing`, the one route with no auth guard. Nothing caught it: `ng serve` uses
 * the `development` configuration and the unit tests import `environment.ts` directly, so neither
 * path ever loaded the production object.
 *
 * The key has since been added back, which fixes that instance and not the class of bug. Both
 * files are now annotated `: Environment`, so the next key added to one and forgotten in the other
 * is a compile error rather than a `TypeError` that only appears in a deployed bundle.
 *
 * A separate file rather than an interface exported from `environment.ts`, because that file is
 * the one being replaced — anything importing from it would vanish from the production build
 * along with it.
 */
export interface Environment {
  /** Same-origin by default; an absolute URL for a deployed split-host setup. */
  apiBaseUrl: string;

  /** Serve the reference fixture instead of calling the backend. */
  useDemoData: boolean;

  billing: {
    /** Whether this build should call the billing endpoints at all. */
    enabled: boolean;
  };
}
