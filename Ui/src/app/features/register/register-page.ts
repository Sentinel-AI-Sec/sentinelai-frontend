import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../core/auth/auth';
import { environment } from '../../core/config/environment';

/**
 * Self-service sign-up (`POST /v1/auth/register`). Always creates a brand-new tenant with the
 * registering user as its first admin — there is no "join an existing tenant" flow here, the
 * same way the backend command documents it.
 */
@Component({
  selector: 'app-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './register-page.html',
  styleUrls: ['../../shared/forms.css', './register-page.css'],
})
export class RegisterPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly tenantName = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly demoMode = environment.useDemoData;

  submit(): void {
    if (this.submitting()) return;

    this.submitting.set(true);
    this.error.set(null);

    this.auth.register(this.email(), this.password(), this.tenantName()).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 0
            ? 'Could not reach the backend. Is the API running?'
            : err instanceof HttpErrorResponse && err.status === 409
              ? 'That email is already registered.'
              : 'Registration failed. Check the details and try again.',
        );
      },
    });
  }
}
