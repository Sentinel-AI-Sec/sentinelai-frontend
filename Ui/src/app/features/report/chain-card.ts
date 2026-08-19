import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Chain, ChainHop, ChainStatus, Finding } from '../../core/api/wire';
import { ConfidenceBadge } from './confidence-badge';

/** A hop paired with the finding that evidences it, resolved once instead of in the template. */
export interface HopView {
  hop: ChainHop;
  finding: Finding | null;
}

/**
 * One candidate exploit chain: its ordered hops, the evidence behind each, and how much of it
 * can be trusted.
 *
 * Rendered as a vertical path rather than a table because the ordering *is* the content — a
 * chain is a claim about reaching something, and a table of hops reads as a list of unrelated
 * facts. The join confidence sits on the connector between two hops, not inside a hop, since
 * that is what it describes: the step, not the thing stepped onto.
 */
@Component({
  selector: 'app-chain-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfidenceBadge],
  templateUrl: './chain-card.html',
  styleUrl: './chain-card.css',
})
export class ChainCard {
  readonly chain = input.required<Chain>();

  /** Findings for this scan, keyed by id, so a hop can show what it is evidenced by. */
  readonly findingsById = input<Map<string, Finding>>(new Map());

  readonly hops = computed<HopView[]>(() => {
    const findings = this.findingsById();
    return [...this.chain().hops]
      .sort((a, b) => a.order - b.order)
      .map((hop) => ({
        hop,
        finding: hop.finding_id ? (findings.get(hop.finding_id) ?? null) : null,
      }));
  });

  /** The last hop is what the chain reaches — the part a reader cares about most. */
  readonly target = computed(() => {
    const hops = this.hops();
    return hops.length > 0 ? (hops[hops.length - 1].hop.node_key ?? 'unknown') : 'unknown';
  });

  readonly validatedCount = computed(() => this.hops().filter((h) => h.hop.blue_validated).length);

  /**
   * Whether Blue accepted the whole path. Anything less is stated as a partial, never rounded
   * up — "validated" on a chain Blue only half-accepted is the most expensive lie this screen
   * could tell.
   */
  readonly fullyValidated = computed(() => this.validatedCount() === this.hops().length);

  severityLabel(severity: number): string {
    return ['none', 'low', 'medium', 'high', 'critical'][severity] ?? String(severity);
  }

  /**
   * A scanner is free to send a severity outside 0–4; clamping keeps such a value inside the
   * palette instead of rendering an unstyled chip that reads as "no severity at all".
   */
  severityClass(severity: number): string {
    return `sev--${Math.min(Math.max(Math.trunc(severity), 0), 4)}`;
  }

  /**
   * Adjudication status as a chip modifier. `candidate` is deliberately neutral rather than
   * amber: it means the debate has not ruled on the chain yet, which is not the same as a
   * warning about it.
   */
  statusClass(status: ChainStatus): string {
    switch (status) {
      case 'validated':
        return 'chip--ok';
      case 'asserted':
        return 'chip--accent';
      case 'rejected':
        return 'chip--mute';
      default:
        return 'chip--mute';
    }
  }
}
