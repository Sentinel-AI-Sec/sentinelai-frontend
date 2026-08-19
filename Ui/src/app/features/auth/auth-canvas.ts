import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The full-viewport frame the two signed-out screens share.
 *
 * Login and register render with no application chrome — there is nothing to navigate to yet,
 * so the shell strips its own bar and nav on these routes — which means each page owns the
 * whole viewport and has to supply its own framing. That framing is identical on both, and a
 * second copy of it is a second place for the product line to go stale, so it lives here once
 * and each page projects only its form.
 *
 * The left panel is not decoration. Someone arriving at a sign-in box for a security tool has
 * to be told what it claims to do *and* what it does not, and the honesty line at the bottom is
 * the same one the footer carries everywhere else — it is the first thing said, not a
 * disclaimer added after the pitch.
 */
@Component({
  selector: 'app-auth-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-canvas.html',
  styleUrl: './auth-canvas.css',
})
export class AuthCanvas {}
