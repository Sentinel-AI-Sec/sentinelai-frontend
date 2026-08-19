import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of } from 'rxjs';

import { environment } from '../config/environment';
import { ResponseEnvelope } from './wire';

/**
 * Account-level operations (`AccountController`) — currently just the right to be deleted.
 */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /**
   * Permanently deletes the calling account and everything it owns: projects, scan jobs, stored
   * bundles, findings, the resource graph, chains and reports. Admin role only, and there is no
   * id parameter — an account can only delete itself.
   *
   * **This cannot be undone.** The caller is responsible for confirming with the user before
   * calling this; there is no server-side grace period to recover from an accidental call.
   */
  deleteAccount(): Observable<void> {
    if (environment.useDemoData) {
      // Nothing to delete against a backend that was never called. The caller still follows up
      // with Auth.logout() either way, so the flow (confirm, delete, sign out) stays intact.
      return of(undefined).pipe(delay(250));
    }

    return this.http
      .delete<ResponseEnvelope<unknown>>(`${this.base}/v1/account`)
      .pipe(map(() => undefined));
  }
}
