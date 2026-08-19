import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Auth } from './core/auth/auth';
import { environment } from './core/config/environment';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly demoMode = environment.useDemoData;

  signOut(): void {
    // logout() revokes the refresh token server-side before dropping the local session; it
    // clears local state and completes even if that call fails, so the navigation always runs.
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }
}
