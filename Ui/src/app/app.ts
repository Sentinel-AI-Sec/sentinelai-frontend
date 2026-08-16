import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { Auth } from './core/auth/auth';
import { environment } from './core/config/environment';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly demoMode = environment.useDemoData;

  signOut(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
