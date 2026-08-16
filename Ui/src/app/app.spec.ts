import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { App } from './app';

describe('App shell', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient()],
    }).compileComponents();
  });

  it('keeps the draft framing in the chrome, not only on the report page', () => {
    // The disclaimer has to survive someone deep-linking, printing, or screenshotting a single
    // chain. Putting it in the footer as well as the banner is what makes that true.
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Draft audits are generated for human review');
    expect(text).toContain('does not execute or prove exploits');
  });

  it('shows no tenant or sign-out control when nobody is signed in', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });
});
