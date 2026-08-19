import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../config/environment';
import { AccountApi } from './account-api';

describe('AccountApi', () => {
  let api: AccountApi;
  let http: HttpTestingController;
  const wasDemo = environment.useDemoData;

  beforeEach(() => {
    environment.useDemoData = false;

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    api = TestBed.inject(AccountApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useDemoData = wasDemo;
    http.verify();
  });

  it('sends DELETE with no body and resolves once the envelope comes back', async () => {
    const promise = firstValueFrom(api.deleteAccount());

    const request = http.expectOne('/v1/account');
    expect(request.request.method).toBe('DELETE');

    request.flush({ statusCode: 200, isSuccess: true, message: 'deleted', data: null });

    await expect(promise).resolves.toBeUndefined();
  });

  it('propagates a 403 rather than swallowing it', async () => {
    let failed = false;
    api.deleteAccount().subscribe({ error: () => (failed = true) });

    http.expectOne('/v1/account').flush('forbidden', { status: 403, statusText: 'Forbidden' });

    expect(failed).toBe(true);
  });

  it('does not call the backend in demo mode', async () => {
    environment.useDemoData = true;

    await firstValueFrom(api.deleteAccount());

    http.expectNone('/v1/account');
  });
});
