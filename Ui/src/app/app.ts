import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { Auth } from './core/auth/auth';
import { Recents } from './core/history/recents';
import { environment } from './core/config/environment';

/** One crumb in the top bar. `link` is absent for the leaf, which is where you already are. */
interface Crumb {
  label: string;
  link?: string;
}

/** A side-nav destination. `match` widens the active state to a section, not just one URL. */
interface NavItem {
  label: string;
  icon: string;
  link: string;
  exact?: boolean;
}

/**
 * The application shell: top bar, side navigation, and the framing that has to outlive any one
 * screen.
 *
 * Two rules shape it.
 *
 * First, **the chrome carries the draft-audit framing**. The footer disclaimer is not
 * decoration — a chain screenshotted out of this app has to arrive somewhere with the words
 * "draft" and "not proven" attached, so it is rendered on every route and is not dismissible.
 *
 * Second, **signed out means chrome-free**. Login and register render on a bare canvas with no
 * navigation, no tenant, and no controls: there is nothing yet to navigate, and a nav bar full
 * of links that all bounce off the auth guard is worse than no nav bar. (The shell test pins
 * this literally — a signed-out shell renders zero buttons.)
 */
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
  protected readonly recents = inject(Recents);
  protected readonly demoMode = environment.useDemoData;

  /** Open on desktop, off-canvas on narrow screens until the menu button is pressed. */
  protected readonly navOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  /**
   * The current URL, as a signal.
   *
   * Seeded with `router.url` rather than starting empty: the shell renders before the first
   * NavigationEnd on a deep link, and a breadcrumb that reads "SentinelAI" for a frame before
   * snapping to the real trail is a visible flicker on every page load.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/', exact: true },
    { label: 'Projects', icon: 'folder_open', link: '/projects' },
    { label: 'New scan', icon: 'radar', link: '/scans/new' },
    { label: 'Debate', icon: 'forum', link: '/debate' },
    { label: 'Account', icon: 'manage_accounts', link: '/account' },
  ];

  /** True on the auth screens, which render without any chrome at all. */
  protected readonly bare = computed(() => {
    const url = this.url();
    return url.startsWith('/login') || url.startsWith('/register');
  });

  /**
   * The trail for the top bar, read off the URL rather than pushed by each page.
   *
   * Pages announcing their own crumbs sounds tidier and is not: every new screen then has to
   * remember to do it, and the one that forgets shows the previous page trail. The URL already
   * knows where you are.
   */
  protected readonly crumbs = computed<Crumb[]>(() => {
    const path = this.url().split('?')[0].split('#')[0];
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0) return [{ label: 'Dashboard' }];

    switch (parts[0]) {
      case 'projects':
        return [{ label: 'Projects' }];

      case 'debate':
        return [{ label: 'Debate playground' }];

      case 'account':
        return [{ label: 'Account' }];

      case 'reports':
        return [
          { label: 'Reports' },
          { label: parts[1] ? short(parts[1]) : 'Report' },
          { label: 'Draft audit' },
        ];

      case 'scans': {
        if (parts[1] === 'new') return [{ label: 'Scans' }, { label: 'Submit a bundle' }];
        const id = parts[1] ? short(parts[1]) : 'scan';
        const leaf =
          parts[2] === 'graph'
            ? 'Resource graph'
            : parts[2] === 'findings'
              ? 'Findings'
              : 'Pipeline ops';
        return [
          { label: 'Scans' },
          { label: id, link: parts[1] ? `/scans/${parts[1]}/ops` : undefined },
          { label: leaf },
        ];
      }

      default:
        return [{ label: 'Dashboard' }];
    }
  });

  protected toggleNav(): void {
    this.navOpen.update((open) => !open);
  }

  protected closeNav(): void {
    this.navOpen.set(false);
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected signOut(): void {
    this.userMenuOpen.set(false);
    // logout() revokes the refresh token server-side before dropping the local session; it
    // clears local state and completes even if that call fails, so the navigation always runs.
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }
}

/**
 * Shortens a GUID for the breadcrumb. The full id stays on the page itself (and is
 * copy-pasteable there) — the trail only needs enough to tell two open tabs apart.
 */
function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
