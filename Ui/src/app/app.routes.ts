import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth-guard';

/**
 * Everything except the login page sits behind the guard, and every screen here is read-only —
 * there is no route that starts a scan or changes anything. That is SEC-42's constraint, kept
 * structural rather than remembered.
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
    title: 'Sign in · SentinelAI',
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
    title: 'SentinelAI',
  },
  {
    path: 'reports/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/report/report-page').then((m) => m.ReportPage),
    title: 'Draft audit · SentinelAI',
  },
  { path: '**', redirectTo: '' },
];
