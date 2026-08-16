import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { environment } from '../../core/config/environment';

/**
 * Sign-in. The screen shows one tenant's data and only ever the signed-in tenant's, so this is
 * where that starts.
 *
 * The failure message is deliberately the same whether the email is unknown or the password is
 * wrong: telling them apart is a way to enumerate who has an account.
 */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly email = signal('');
  readonly password = signal('');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly demoMode = environment.useDemoData;

  submit(): void {
    if (this.submitting()) return;

    this.submitting.set(true);
    this.error.set(null);

    this.auth.login(this.email(), this.password()).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
        void this.router.navigateByUrl(returnUrl);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 0
            ? 'Could not reach the backend. Is the API running?'
            : 'That email and password did not match an account.',
        );
      },
    });
  }
}
