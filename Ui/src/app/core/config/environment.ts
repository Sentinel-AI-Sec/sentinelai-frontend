/**
 * Runtime configuration for the read-only report UI (SEC-42).
 *
 * `apiBaseUrl` is empty on purpose: requests go to same-origin `/v1/...` and the Angular dev
 * proxy (proxy.conf.json) forwards them to the backend. That keeps the JWT out of a
 * cross-origin request in development, and means the API needs no CORS configuration for us.
 */
export const environment = {
  /** Same-origin by default; set to an absolute URL only for a deployed split-host setup. */
  apiBaseUrl: '',

  /**
   * Serve the reference fixture's audit instead of calling the backend.
   *
   * The screen stays demoable and testable without a running API, a database, or a scanned
   * repository — which is what makes it reviewable before the pipeline is wired end to end.
   * Flip this to false and the same components talk to the real endpoints; nothing else
   * changes, because the demo source returns the exact wire shapes the API sends.
   *
   * Now false: the screen reads the deployed API. `proxy.conf.json` forwards /v1 server-side
   * to the Azure Container App, so the browser still sees same-origin and CORS is never
   * consulted — the backend's SEC-42 policy only comes into play once this UI is served from
   * its own host rather than through `ng serve`.
   */
  useDemoData: false,
};
