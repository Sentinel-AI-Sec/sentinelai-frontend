import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The flagship exploit chain, drawn.
 *
 * <h3>Why this exists</h3>
 *
 * Every scanner in the toolchain reports the six things below in isolation: a vulnerable package,
 * an unsafe deserialization, a wildcard IAM policy, an unencrypted bucket. Each one on its own is a
 * medium-severity line in a report nobody reads to the end. The product's entire claim is that they
 * compose into one path from a dependency to a customer-data bucket, and that claim is far easier
 * to see than to describe — which is what this is for.
 *
 * <h3>Why it is hand-authored and not fed from an API</h3>
 *
 * It is an illustration, not a visualisation. It appears on the public pricing page, where there is
 * no tenant and no scan to read from, and on the console's home screen, where it explains what a
 * scan will produce before the reader has run one. The real graph — the same vocabulary, drawn from
 * real data — lives at <c>/scans/:id/graph</c>.
 *
 * The chain drawn here is the fixture's, so it is a real result rather than an invented one:
 * `sentinelai-fixtures` plants exactly this path and the backend's `FlagshipChainTests` asserts the
 * pipeline still finds it.
 *
 * <h3>The unresolved edge is the point</h3>
 *
 * The dangling `legacy_worker` join is drawn deliberately, and drawn differently. The fixture plants
 * a task whose image reference cannot be resolved to any Dockerfile, and the product's honesty
 * claim is that it surfaces that as an unverified join rather than dropping it or asserting it. An
 * illustration showing only the clean path would be advertising a different product — one that is
 * always certain — so the tier vocabulary (certain / inferred / unresolved) is on the page in the
 * same colours the real graph uses.
 */
@Component({
  selector: 'app-chain-illustration',
  templateUrl: './chain-illustration.html',
  styleUrl: './chain-illustration.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainIllustration {
  /**
   * Whether to show the legend and the caption beneath the diagram.
   *
   * On the marketing page they carry the explanation; on the console's home screen the reader has
   * the real graph a click away and the diagram is a signpost, so the chrome is turned off.
   */
  readonly detailed = input(true);
}
