import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Chain, ChainHop, ChainStatus, Finding, HopVerdict } from '../../core/api/wire';
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

  readonly confirmedCount = computed(
    () => this.hops().filter((h) => h.hop.blue_verdict === 'confirmed').length,
  );

  readonly refutedCount = computed(
    () => this.hops().filter((h) => h.hop.blue_verdict === 'refuted').length,
  );

  /**
   * Whether Blue judged this chain at all.
   *
   * A chain straight out of the graph stage has every hop `unassessed`, and the old screen
   * reported that as "Blue validated 0 of 5 steps" — a sentence that reads as a finding when it
   * is really an empty column (audit 42-A). If nobody has looked, the card says so and stops.
   */
  readonly adjudicated = computed(() =>
    this.hops().some((h) => h.hop.blue_verdict !== 'unassessed'),
  );

  /**
   * The one-line verdict for the whole chain, written from what Blue actually said.
   *
   * Deliberately not a count of `blue_validated`. That field collapses four different states
   * into one `false`, so counting it turns "nobody has looked yet" and "Blue contradicted this"
   * into the same sentence. The order below is the order that matters to a reader: a refutation
   * outranks everything, then a clean sweep, then the honest partial.
   */
  readonly summary = computed(() => {
    const total = this.hops().length;

    if (!this.adjudicated()) {
      return 'No debate has judged this chain yet — its steps come straight from the graph.';
    }

    const refuted = this.refutedCount();
    if (refuted > 0) {
      return `Blue contradicted ${refuted} of ${total} steps`;
    }

    const confirmed = this.confirmedCount();
    if (confirmed === total) return 'Blue confirmed every step';

    // The remainder is unresolved or unattributed — never stated as a negative, because
    // neither is one.
    return `Blue confirmed ${confirmed} of ${total} steps; the rest it could not settle`;
  });

  /**
   * Whether this hop has a technique to link to.
   *
   * `technique_id` is empty whenever Red named none the scan could ground, which is the normal
   * case rather than a missing value. Appending an empty id to MITRE's technique URL yields a
   * link to their index wearing the label of a specific technique — the exact defect audit 42-A
   * found on every chain in the product.
   */
  hasTechnique(hop: ChainHop): boolean {
    return hop.technique_id.trim().length > 0;
  }

  /** ATT&CK sub-techniques are addressed `T1195/001`, not `T1195.001`. */
  techniqueUrl(hop: ChainHop): string {
    return `https://attack.mitre.org/techniques/${hop.technique_id.replace('.', '/')}`;
  }

  /**
   * How a hop's verdict is labelled. `unassessed` and `unattributed` say plainly that nothing
   * was decided, rather than borrowing the vocabulary of a failure.
   */
  verdictLabel(verdict: HopVerdict): string {
    switch (verdict) {
      case 'confirmed':
        return 'confirmed';
      case 'refuted':
        return 'refuted';
      case 'unresolved':
        return 'could not settle';
      case 'unattributed':
        return 'not addressed';
      default:
        return 'not judged';
    }
  }

  /** The reason behind the label, on hover. */
  verdictHint(verdict: HopVerdict): string {
    switch (verdict) {
      case 'confirmed':
        return 'Blue found the configuration shows this step is real, and named the evidence.';
      case 'refuted':
        return 'Blue found the configuration positively contradicts this step.';
      case 'unresolved':
        return 'Blue said the evidence given cannot settle this step either way. That is not evidence against it.';
      case 'unattributed':
        return 'Blue’s turn was read and nothing in it could be tied to this step. Not a judgement about the step.';
      default:
        return 'No debate has run over this chain, so nothing has been judged.';
    }
  }

  /**
   * Colour for the verdict chip. Only `refuted` is allowed to read as negative; the three
   * not-a-judgement states stay neutral so they cannot be mistaken for one.
   */
  verdictClass(verdict: HopVerdict): string {
    switch (verdict) {
      case 'confirmed':
        return 'chip--ok';
      case 'refuted':
        return 'chip--danger';
      case 'unresolved':
        return 'chip--warn';
      default:
        return 'chip--mute';
    }
  }

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
