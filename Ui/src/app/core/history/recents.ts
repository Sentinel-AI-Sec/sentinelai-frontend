import { Injectable, computed, inject, signal } from '@angular/core';

import { Auth } from '../auth/auth';

/**
 * What this browser has opened, so the console has somewhere to send you back to.
 *
 * This used to say the read API had no way to enumerate scans, and that a jump list was the only
 * honest substitute. That gap has since closed: `GET /v1/scans` is tenant-scoped, cursor-paged and
 * served by the backend, and `/scans` renders it — so the organisation's history is now a real
 * list rather than something the UI would have had to invent.
 *
 * This still earns its place, for a different reason. It is a *per-browser* jump list: the handful
 * of things you personally opened, ordered by when you opened them, available in one click without
 * a round trip. The history screen answers "what has this organisation scanned"; this answers
 * "where was I". Neither replaces the other, and this one is still labelled local wherever it is
 * shown, because it says nothing about anyone else's work.
 *
 * So this stores exactly what it can honestly claim — the ids *you* submitted or opened, in
 * *this* browser — and every surface that renders it says so. When a list endpoint lands, this
 * service is what gets replaced, and the screens above it keep their shape.
 *
 * Entries are keyed by tenant, because a browser can be signed into more than one over time
 * and one tenant must never see another tenant ids. Nothing here is authoritative: it is a
 * convenience index, and every id in it is still authorised server-side on the way out.
 */

export type RecentKind = 'scan' | 'report';

export interface RecentEntry {
  kind: RecentKind;
  /** The scan job id or report id — whatever addresses it on the API. */
  id: string;
  /** Something human to recognise it by: a repo URL, a PR ref, a commit sha. */
  label?: string;
  /** ISO timestamp of the last time this browser touched it. */
  seenAt: string;
}

const StorageKey = 'sentinelai.recents';

/** Enough to be useful as a jump list, few enough that it stays a jump list. */
const MaxPerTenant = 12;

type Store = Record<string, RecentEntry[]>;

@Injectable({ providedIn: 'root' })
export class Recents {
  private readonly auth = inject(Auth);
  private readonly store = signal<Store>(restore());

  /** Everything remembered for the signed-in tenant, newest first. */
  readonly entries = computed<RecentEntry[]>(() => {
    const tenant = this.auth.tenantId();
    if (!tenant) return [];
    return this.store()[tenant] ?? [];
  });

  readonly scans = computed(() => this.entries().filter((e) => e.kind === 'scan'));
  readonly reports = computed(() => this.entries().filter((e) => e.kind === 'report'));

  /**
   * Records (or refreshes) one id. Re-noting an id moves it to the front and keeps the richer
   * label of the two — a later visit that knows only the id should not erase the repo name an
   * earlier one recorded.
   */
  note(kind: RecentKind, id: string, label?: string): void {
    const tenant = this.auth.tenantId();
    if (!tenant || !id) return;

    const existing = this.store()[tenant] ?? [];
    const previous = existing.find((e) => e.kind === kind && e.id === id);
    const entry: RecentEntry = {
      kind,
      id,
      label: label ?? previous?.label,
      seenAt: new Date().toISOString(),
    };

    const next = [entry, ...existing.filter((e) => !(e.kind === kind && e.id === id))].slice(
      0,
      MaxPerTenant,
    );

    this.commit(tenant, next);
  }

  forget(kind: RecentKind, id: string): void {
    const tenant = this.auth.tenantId();
    if (!tenant) return;

    const next = (this.store()[tenant] ?? []).filter((e) => !(e.kind === kind && e.id === id));
    this.commit(tenant, next);
  }

  clear(): void {
    const tenant = this.auth.tenantId();
    if (!tenant) return;

    this.commit(tenant, []);
  }

  /**
   * Writes one tenant's list through to both the signal and storage.
   *
   * Kept out of `signal.update()` on purpose: an updater is expected to be a pure function of
   * the previous value, and a localStorage write inside one is the kind of side effect that
   * silently doubles if the framework ever re-runs it.
   */
  private commit(tenant: string, entries: RecentEntry[]): void {
    const updated = { ...this.store(), [tenant]: entries };
    this.store.set(updated);
    persist(updated);
  }
}

function restore(): Store {
  try {
    const raw = localStorage.getItem(StorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    // A hand-edited or half-written value should cost a jump list, never a boot.
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist(store: Store): void {
  try {
    localStorage.setItem(StorageKey, JSON.stringify(store));
  } catch {
    // A full or blocked localStorage is not worth failing a navigation over; the list is a
    // convenience, and the in-memory signal still works for the rest of the session.
  }
}
