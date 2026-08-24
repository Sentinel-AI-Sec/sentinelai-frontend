/**
 * The three roles this console presents, and what each of them may reach.
 *
 * <b>These are UI roles, not the backend's.</b> The backend issues `admin`, `analyst` or
 * `viewer` in the token's role claim (`Roles.cs`); the console speaks in `user`, `admin` and
 * `dev`. {@link toUiRole} is the one place the two vocabularies meet, so a rename on either
 * side is a change to a single switch rather than a hunt through templates.
 *
 * <b>Nothing here is a security control.</b> Every area below is enforced again by the API —
 * `POST /v1/projects` and `POST /v1/auth/machine-token` are role-gated server-side, and the
 * tenant filter runs regardless. Hiding a nav item stops someone being shown a door that will
 * only 403; it does not lock the door. A `user` who types `/setup` into the address bar is
 * bounced by {@link areaGuard} and would have been refused by the API anyway.
 */

/** What the console calls the signed-in person. */
export type UiRole = 'user' | 'admin' | 'dev';

/**
 * A gated region of the console. One entry per side-nav destination, plus `newScan` for
 * `/scans/new`, which is reachable by URL but deliberately absent from the navigation.
 *
 * `dashboard`, `scans`, `billing` and `account` are listed even though every role holds them.
 * A permission table that only names the exceptions cannot be read as a table — the reason
 * `user` reaches billing should be visible next to the reason it does not reach setup.
 */
export type Area =
  | 'dashboard'
  | 'projects'
  | 'setup'
  | 'scans'
  | 'newScan'
  | 'debate'
  | 'billing'
  | 'account';

/**
 * Who may see what.
 *
 * - `user` — their own account, what it costs, and the scans that have run. No project
 *   registration and no CI setup: both hand out something that outlives the session (a project
 *   row, a machine token), which is not a self-service action.
 * - `admin` — runs the tenant: everything above plus projects and CI setup. Not the debate
 *   playground, which drives the reasoning engine directly rather than reading its output.
 * - `dev` — everything, the playground included.
 *
 * Spelled out per role rather than layered (`admin = user + …`) on purpose: the sets are small,
 * and the one difference that actually matters here — `admin` having strictly more than `user`
 * while still not having `debate` — is invisible in a model that only ever adds.
 */
const AreaAccess: Record<UiRole, readonly Area[]> = {
  user: ['dashboard', 'scans', 'billing', 'account'],
  admin: ['dashboard', 'projects', 'setup', 'scans', 'newScan', 'billing', 'account'],
  dev: ['dashboard', 'projects', 'setup', 'scans', 'newScan', 'debate', 'billing', 'account'],
};

/**
 * The console role for a backend role claim.
 *
 * Both vocabularies are accepted, so this keeps working whichever one the token carries. The
 * default is `user`, the least-privileged of the three, which is what makes an unrecognized
 * role safe: a claim this build has never heard of grants the minimum rather than falling
 * through to something it happens to sort next to. A missing claim — a machine token, which
 * carries none — lands in the same place.
 */
export function toUiRole(claim: string | null | undefined): UiRole {
  switch (claim) {
    case 'dev':
    case 'analyst':
      return 'dev';
    case 'admin':
      return 'admin';
    default:
      return 'user';
  }
}

/** Whether a role reaches an area. */
export function canSee(role: UiRole, area: Area): boolean {
  return AreaAccess[role].includes(area);
}
