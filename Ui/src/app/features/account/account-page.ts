import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  AccountApi,
  AddMemberResult,
  MemberDto,
  MemberRole,
  MemberRoles,
} from '../../core/api/account-api';
import { Auth, Session } from '../../core/auth/auth';
import { environment } from '../../core/config/environment';

/**
 * Account settings — who you are signed in as, who else is in the organisation and what they may
 * do (`GET`/`PATCH /v1/account/members`), and the right to be deleted (`DELETE /v1/account`).
 *
 * The scopes are shown because they are the reason the rest of the console behaves the way it
 * does: a missing `scan:write` is why the submit form is gated, and a screen that hides the
 * cause turns every gate into an unexplained refusal. The members table shows them for the same
 * reason, one person over — an admin picking a role should see what it hands out.
 *
 * <b>The members table speaks the backend's role names, not the console's.</b> Everywhere else
 * `analyst` is rendered as `dev` (see `roles.ts`); here the value being chosen is the one that
 * will sit in someone's token and be compared verbatim by the API, so translating it would mean
 * the thing an admin picked and the thing they can verify never match.
 *
 * Deletion is admin-only and irreversible on the backend: no soft-delete, no grace period. The
 * confirmation step here (typing the tenant id back) is this screen's entire safety net, so it
 * is not skippable the way a plain confirm() dialog would be.
 */
@Component({
  selector: 'app-account-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  templateUrl: './account-page.html',
  styleUrl: './account-page.css',
})
export class AccountPage implements OnInit {
  private readonly api = inject(AccountApi);
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly confirmation = signal('');
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);
  readonly copied = signal(false);

  readonly isAdmin = this.auth.role() === 'admin';
  readonly demoMode = environment.useDemoData;

  /** The three assignable roles, for the per-row selector. */
  readonly roles = MemberRoles;

  readonly members = signal<MemberDto[]>([]);
  readonly membersLoading = signal(false);
  readonly membersError = signal<string | null>(null);

  /** The member whose role is mid-flight, so one row's spinner does not disable the others. */
  readonly savingMemberId = signal<string | null>(null);
  readonly memberError = signal<string | null>(null);

  /** The last member whose role this screen changed, for the confirmation note under the table. */
  readonly changed = signal<MemberDto | null>(null);

  // ---- Adding a member ---------------------------------------------------------------------

  readonly newEmail = signal('');
  readonly newRole = signal<MemberRole>('viewer');
  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);

  /** The last completed add, so the screen can report what happened to their old organisation. */
  readonly added = signal<AddMemberResult | null>(null);

  /**
   * Whether the form is ready to submit. Only a shape check — whether the address belongs to a
   * registered account is a question only the API can answer, and it answers it with a 404 that
   * {@link addMember} turns into the message people actually need.
   */
  readonly canAdd = (): boolean => /^\S+@\S+\.\S+$/.test(this.newEmail().trim());

  addMember(): void {
    if (this.adding() || !this.canAdd()) return;

    this.adding.set(true);
    this.addError.set(null);
    this.added.set(null);

    this.api.addMember(this.newEmail().trim(), this.newRole()).subscribe({
      next: (result) => {
        this.members.update((current) => [...current, result.member]);
        this.adding.set(false);
        this.added.set(result);
        this.newEmail.set('');
      },
      error: (err: unknown) => {
        this.adding.set(false);
        this.addError.set(addMessageFor(err));
      },
    });
  }

  ngOnInit(): void {
    // Only admins can read this list, and the section is hidden for everyone else — issuing the
    // request anyway would spend a round trip to be told a 403 the role already predicts.
    if (this.isAdmin) this.loadMembers();
  }

  /**
   * Whether this row is the signed-in admin: their own role is not theirs to change.
   *
   * False when the session predates `userId` — the row stays editable and the API answers 400,
   * which the table surfaces. Guessing "this might be you" from an email would be worse: it
   * would lock a real admin out of a change they are allowed to make.
   */
  readonly isSelf = (member: MemberDto): boolean => {
    const id = this.auth.userId();
    return id !== null && member.userId === id;
  };

  loadMembers(): void {
    this.membersLoading.set(true);
    this.membersError.set(null);

    this.api.listMembers().subscribe({
      next: (members) => {
        this.members.set(members);
        this.membersLoading.set(false);
      },
      error: () => {
        this.membersLoading.set(false);
        this.membersError.set('Could not load the members of this organisation.');
      },
    });
  }

  changeRole(member: MemberDto, role: string): void {
    // The <select> hands back a plain string. Narrowing rather than casting: a value that is not
    // one of the three would be refused by the API anyway, and sending it would turn a bug here
    // into a 400 the user has to interpret.
    if (this.savingMemberId() || !isMemberRole(role) || role === member.role) return;

    this.savingMemberId.set(member.userId);
    this.memberError.set(null);
    this.changed.set(null);

    this.api.changeMemberRole(member.userId, role).subscribe({
      next: (updated) => {
        this.members.update((current) =>
          current.map((m) => (m.userId === updated.userId ? updated : m)),
        );
        this.savingMemberId.set(null);
        this.changed.set(updated);
      },
      error: (err: unknown) => {
        this.savingMemberId.set(null);
        this.memberError.set(messageFor(err));
      },
    });
  }

  readonly confirmationMatches = () => this.confirmation().trim() === (this.auth.tenantId() ?? '');

  /** The console role's first letter, for the identity disc — matching the shell's avatar. */
  readonly initial = () => this.auth.uiRole()[0].toUpperCase();

  /**
   * The stored session. Null between sign-out and the navigation that follows it, so the
   * scopes and expiry blocks render conditionally — the role, the tenant and the delete
   * confirmation are what this screen has to get right, and they do not depend on it.
   */
  readonly session = (): Session | null => this.auth.session();

  copyTenantId(): void {
    const tenantId = this.auth.tenantId();
    if (!tenantId) return;

    void navigator.clipboard?.writeText(tenantId).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1600);
      },
      () => this.copied.set(false),
    );
  }

  deleteAccount(): void {
    if (this.deleting() || !this.confirmationMatches()) return;

    this.deleting.set(true);
    this.error.set(null);

    this.api.deleteAccount().subscribe({
      next: () => {
        // The account no longer exists, so there is nothing left to sign out of server-side —
        // this only needs to drop the local session and leave.
        this.auth.dropSession();
        void this.router.navigate(['/login']);
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 403
            ? 'The admin role is required to delete the account.'
            : 'Could not delete the account.',
        );
      },
    });
  }
}

/**
 * Turns a failed add into something an admin can act on.
 *
 * The 404 gets the longest wording because it is the one people will hit most and the one whose
 * cause is least obvious: this endpoint moves accounts that already exist, and cannot create one.
 * "Not found" alone would read as a bug in the lookup rather than as a person who has not signed
 * up yet.
 */
function addMessageFor(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return 'Could not add this member.';

  switch (err.status) {
    case 400:
      return 'That does not look like a valid email address.';
    case 403:
      return 'The admin role is required to add a member.';
    case 404:
      return 'No account is registered with that address. They need to sign up first — this cannot create an account for them.';
    case 409:
      // Two different conflicts, and the server's own message distinguishes them far better
      // than a status code can: already a member here, or the last admin somewhere else.
      return messageFromEnvelope(err) ?? 'That account cannot be added to this organisation.';
    default:
      return 'Could not add this member.';
  }
}

/** The API's own explanation, when it sent one in the standard envelope. */
function messageFromEnvelope(err: HttpErrorResponse): string | null {
  const envelope = err.error as { message?: string } | null;
  const message = envelope?.message?.trim();
  return message ? message : null;
}

function isMemberRole(value: string): value is MemberRole {
  return (MemberRoles as readonly string[]).includes(value);
}

/**
 * Turns a failed role change into something an admin can act on.
 *
 * The two specific cases are both the endpoint working correctly rather than breaking, so they
 * get their own wording: a generic "could not save" would read as a bug and invite a retry that
 * is certain to fail the same way.
 */
function messageFor(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return 'Could not change this member’s role.';

  switch (err.status) {
    case 400:
      return 'You cannot change your own role — ask another admin to do it.';
    case 403:
      return 'The admin role is required to change a member’s role.';
    case 404:
      return 'That member is no longer part of this organisation.';
    default:
      return 'Could not change this member’s role.';
  }
}
