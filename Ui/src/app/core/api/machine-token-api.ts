import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of } from 'rxjs';

import { environment } from '../config/environment';
import { ResponseEnvelope } from './wire';

/**
 * A freshly minted machine token (`MachineTokenResponse.cs`).
 *
 * camelCase, like the other auth DTOs and unlike the SEC-40 read views in `wire.ts` — that half
 * of the API carries explicit `[JsonPropertyName]` attributes and this one does not.
 */
export interface MachineTokenDto {
  /** The JWT itself. Goes into the `SENTINELAI_MACHINE_TOKEN` repository secret. */
  token: string;
  expiresAt: string;
  /** What the token may do, echoed so the screen can say so without decoding it. */
  scopes: string[];
  tenantId: string;
}

/**
 * Mints the credential the GitHub Action authenticates with (`POST /v1/auth/machine-token`).
 *
 * Admin-only on the backend, so the caller should gate the button on `auth.role() === 'admin'`
 * rather than letting it 403.
 *
 * **Nothing here stores the token, because nothing on the server does either.** There is no
 * `get()` to pair with this `mint()` — the API returns the token once and keeps no copy, so a
 * caller who loses it mints another. That is why the screen shows it inline instead of listing
 * previously issued ones: there is no such list to show.
 */
@Injectable({ providedIn: 'root' })
export class MachineTokenApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  mint(): Observable<MachineTokenDto> {
    if (environment.useDemoData) {
      // Shaped like a real JWT — three dot-separated base64url segments — so the screen's
      // truncation, wrapping and copy behaviour are exercised rather than approximated by a
      // short string. It is signed with nothing and authenticates against nothing.
      return of({
        token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
          'eyJ0ZW5hbnRfaWQiOiJkZW1vLXRlbmFudCIsInNjb3BlIjoic2Nhbjp3cml0ZSBzY2FuOnJlYWQgcmVwb3J0OnJlYWQifQ.' +
          'demo-signature-this-token-authenticates-against-nothing',
        expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        scopes: ['scan:write', 'scan:read', 'report:read'],
        tenantId: 'demo-tenant',
      }).pipe(delay(400));
    }

    return this.http
      .post<ResponseEnvelope<MachineTokenDto>>(`${this.base}/v1/auth/machine-token`, null)
      .pipe(map((envelope) => envelope.data));
  }
}
