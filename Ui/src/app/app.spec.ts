import { provideHttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { App } from './app';

/** Somewhere for the shell's routes to land, so navigation in a test is real. */
@Component({ template: '' })
class Blank {}

const routes = [
  { path: '', component: Blank },
  { path: 'login', component: Blank },
  { path: 'projects', component: Blank },
  { path: 'scans/:id/graph', component: Blank },
];

/** A session shaped like the real one, written where `Auth` restores it from. */
function signIn(): void {
  localStorage.setItem(
    'sentinelai.session',
    JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      tenantId: 'tenant-1',
      role: 'analyst',
      scopes: ['scan:read'],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
}

describe('App shell', () => {
  beforeEach(async () => {
    localStorage.clear();
  });

  async function render(url = '/'): Promise<ComponentFixture<App>> {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient()],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    if (url !== '/') {
      await TestBed.inject(Router).navigateByUrl(url);
      fixture.detectChanges();
    }

    return fixture;
  }

  function textOf(fixture: ComponentFixture<App>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('keeps the draft framing in the chrome, not only on the report page', async () => {
    // The disclaimer has to survive someone deep-linking, printing, or screenshotting a single
    // chain. Putting it in the footer as well as the banner is what makes that true.
    const fixture = await render();

    const text = textOf(fixture);
    expect(text).toContain('Draft audits are generated for human review');
    expect(text).toContain('does not execute or prove exploits');
  });

  it('shows no tenant or sign-out control when nobody is signed in', async () => {
    const fixture = await render();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('offers no navigation when nobody is signed in', async () => {
    // Every destination is behind the guard, so a nav bar full of links that all bounce back to
    // /login is worse than no nav bar.
    const fixture = await render();

    expect((fixture.nativeElement as HTMLElement).querySelector('.sidenav')).toBeNull();
  });

  it('renders the console chrome once a session exists', async () => {
    signIn();
    const fixture = await render();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.sidenav')).not.toBeNull();

    const text = textOf(fixture);
    expect(text).toContain('analyst');
    expect(text).toContain('tenant-1');
    expect(text).toContain('Projects');
  });

  it('strips the chrome entirely on the auth screens', async () => {
    // Login owns its whole viewport: there is nothing to navigate to yet, and the split brand
    // canvas is the screen, not a page inside a frame.
    signIn();
    const fixture = await render('/login');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.sidenav')).toBeNull();
    expect(host.querySelector('.topbar')).toBeNull();
    // The framing is not chrome — it stays.
    expect(textOf(fixture)).toContain('Draft audits are generated for human review');
  });

  it('derives the breadcrumb trail from the URL rather than from each page', async () => {
    // Pages announcing their own crumbs means the page that forgets shows the previous one's.
    signIn();
    const fixture = await render('/scans/8f2c1d4a-0000-4000-8000-000000000000/graph');

    expect(fixture.componentInstance['crumbs']().map((c) => c.label)).toEqual([
      'Scans',
      '8f2c1d4a…',
      'Resource graph',
    ]);
  });
});
