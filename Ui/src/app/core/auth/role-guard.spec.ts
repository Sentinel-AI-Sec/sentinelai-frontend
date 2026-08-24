import { provideHttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { authGuard } from './auth-guard';
import { areaGuard } from './role-guard';

/** Somewhere for the guarded routes to land, so a blocked navigation is a real one. */
@Component({ template: 'home' })
class Blank {}

const routes = [
  { path: '', component: Blank },
  { path: 'login', component: Blank },
  { path: 'billing', canActivate: [authGuard, areaGuard('billing')], component: Blank },
  { path: 'projects', canActivate: [authGuard, areaGuard('projects')], component: Blank },
  { path: 'setup', canActivate: [authGuard, areaGuard('setup')], component: Blank },
  { path: 'debate', canActivate: [authGuard, areaGuard('debate')], component: Blank },
];

function signIn(role: string): void {
  localStorage.setItem(
    'sentinelai.session',
    JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      tenantId: 'tenant-1',
      role,
      scopes: ['scan:read'],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
}

/**
 * What the address bar can reach.
 *
 * The navigation hiding a link is not the control — someone who bookmarked `/setup` before their
 * role changed, or who simply types it, has to land somewhere sensible. These tests are the half
 * of the pairing that the shell's nav tests do not cover.
 */
describe('areaGuard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** Navigates and reports where the router actually ended up. */
  async function landsAt(url: string): Promise<string> {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient()],
    });

    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router.url;
  }

  it('lets a dev through to every guarded screen', async () => {
    signIn('analyst');
    expect(await landsAt('/debate')).toBe('/debate');
  });

  it('turns an admin away from the debate playground', async () => {
    signIn('admin');
    expect(await landsAt('/debate')).toBe('/');
  });

  it('leaves an admin the screens that run the tenant', async () => {
    signIn('admin');
    expect(await landsAt('/projects')).toBe('/projects');
  });

  it('turns a user away from CI setup and project registration', async () => {
    signIn('viewer');
    expect(await landsAt('/setup')).toBe('/');
    expect(await landsAt('/projects')).toBe('/');
  });

  it('sends a blocked visitor to the dashboard, not to the login form', async () => {
    // Their session is fine — it is the role that is wrong. Bouncing to /login would tell them
    // the opposite of what happened, and signing in again would not change the outcome.
    signIn('viewer');
    const landed = await landsAt('/debate');
    expect(landed).toBe('/');
    expect(landed).not.toContain('login');
  });

  it('still sends someone signed out to login, with where they were headed', async () => {
    // authGuard runs first for exactly this: signed out, `uiRole` resolves to `user`, so a lone
    // areaGuard would silently bounce them to a dashboard they cannot see either.
    expect(await landsAt('/billing')).toBe('/login?returnUrl=%2Fbilling');
  });
});
