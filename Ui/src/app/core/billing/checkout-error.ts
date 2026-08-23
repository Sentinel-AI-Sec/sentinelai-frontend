/**
 * What to tell someone whose billing action did not go through.
 *
 * The API answers a refusal with a sentence in the response envelope's `message` — "starting a
 * subscription requires the admin role", "'enterprise' is not sold monthly on this deployment",
 * "this organisation has no billing account yet — start a subscription first" — and every one of
 * those is something the reader can act on. A viewer shown only "could not start checkout" would
 * try again, get the same nothing, and open a support ticket about a system working exactly as
 * designed.
 *
 * **A network failure is not given the server's voice.** When there is no envelope to read — the
 * request never arrived, or the response was not ours — the caller's own line is used, rather
 * than whatever string happened to be on the error object, which would otherwise put an Angular
 * transport message in front of a customer.
 */
export function billingErrorMessage(err: unknown, fallback: string, suffix = ''): string {
  const message =
    typeof err === 'object' && err !== null && 'error' in err
      ? (err as { error?: { message?: unknown } }).error?.message
      : undefined;

  return typeof message === 'string' && message.trim().length > 0
    ? `${message.trim()}${suffix}`
    : fallback;
}

/**
 * The reassurance appended to any failed checkout, and the part that must never be dropped.
 *
 * Whatever went wrong, no card has been charged — because no card has been entered. The form
 * lives on Stripe's page, which a failed checkout never reached. That sentence is the first thing
 * anybody wants when a payment button fails, and it is true by construction rather than by
 * inspection.
 *
 * Not appended to portal failures: opening the portal is not a charge, and volunteering that
 * nothing was charged invites the reader to wonder whether something might have been.
 */
export const NOTHING_CHARGED = '. Nothing has been charged.';

/** The generic line for a checkout that did not start. */
export const CHECKOUT_FAILED =
  'Could not start checkout. Nothing has been charged — please try again.';

/** The generic line for a portal session that could not be opened. */
export const PORTAL_FAILED = 'Could not open the billing portal. Please try again.';

/**
 * The HTTP status of a failed request, or null when it did not come from one.
 *
 * Narrow on purpose. The only status this app branches on is `503` — "this deployment has no
 * Stripe account" — which is a state to render rather than an error to report. Everything else
 * is already carried by the server's own sentence, and switching on more statuses here would
 * duplicate messages the API is better placed to write.
 */
export function statusOf(err: unknown): number | null {
  return typeof err === 'object' && err !== null && 'status' in err
    && typeof (err as { status: unknown }).status === 'number'
    ? (err as { status: number }).status
    : null;
}
