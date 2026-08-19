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
};
