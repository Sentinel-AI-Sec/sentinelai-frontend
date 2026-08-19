import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AccountApi } from '../../core/api/account-api';
import { Auth, Session } from '../../core/auth/auth';
import { environment } from '../../core/config/environment';

/**
 * Account settings — who you are signed in as, and the right to be deleted
 * (`DELETE /v1/account`).
 *
 * The scopes are shown because they are the reason the rest of the console behaves the way it
 * does: a missing `scan:write` is why the submit form is gated, and a screen that hides the
 * cause turns every gate into an unexplained refusal.
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
export class AccountPage {
  private readonly api = inject(AccountApi);
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly confirmation = signal('');
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);
  readonly copied = signal(false);

  readonly isAdmin = this.auth.role() === 'admin';
  readonly demoMode = environment.useDemoData;

  readonly confirmationMatches = () => this.confirmation().trim() === (this.auth.tenantId() ?? '');

  /** The role's first letter, for the identity disc. */
  readonly initial = () => (this.auth.role() ?? '?')[0].toUpperCase();

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
