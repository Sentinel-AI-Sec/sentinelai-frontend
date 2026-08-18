import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AccountApi } from '../../core/api/account-api';
import { Auth } from '../../core/auth/auth';
import { environment } from '../../core/config/environment';

/**
 * Account settings — currently just the right to be deleted (`DELETE /v1/account`).
 *
 * Admin role only, and irreversible on the backend: no soft-delete, no grace period. The
 * confirmation step here (typing the tenant id back) is this screen's entire safety net, so it
 * is not skippable the way a plain confirm() dialog would be.
 */
@Component({
  selector: 'app-account-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './account-page.html',
  styleUrls: ['../../shared/forms.css', './account-page.css'],
})
export class AccountPage {
  private readonly api = inject(AccountApi);
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly confirmation = signal('');
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);

  readonly isAdmin = this.auth.role() === 'admin';
  readonly demoMode = environment.useDemoData;

  readonly confirmationMatches = () => this.confirmation().trim() === (this.auth.tenantId() ?? '');

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
