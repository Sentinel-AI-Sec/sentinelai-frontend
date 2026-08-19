import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth-guard';

/**
 * `/`, `/login` and `/reports/:id` are the original SEC-42 read-only surface — no route there
 * starts a scan or changes anything. Everything below `/projects` is the ops/admin surface added
 * on top of it: submitting a scan, driving its stages, running a debate directly, and account
 * management. Each of those screens gates its own write actions on the signed-in role/scope
 * (the backend enforces the same checks; the UI gate exists so someone without permission sees
 * why, rather than a raw 403).
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
    title: 'Sign in · SentinelAI',
  },
  {
    path: 'register',
    loadComponent: () => import('./features/register/register-page').then((m) => m.RegisterPage),
    title: 'Create organisation · SentinelAI',
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
  {
    path: 'projects',
    canActivate: [authGuard],
    loadComponent: () => import('./features/projects/projects-page').then((m) => m.ProjectsPage),
    title: 'Projects · SentinelAI',
  },
  {
    path: 'scans/new',
    canActivate: [authGuard],
    loadComponent: () => import('./features/scans/new-scan-page').then((m) => m.NewScanPage),
    title: 'Submit a scan · SentinelAI',
  },
  {
    path: 'scans/:id/ops',
    canActivate: [authGuard],
    loadComponent: () => import('./features/scans/scan-ops-page').then((m) => m.ScanOpsPage),
    title: 'Scan ops · SentinelAI',
  },
  {
    path: 'debate',
    canActivate: [authGuard],
    loadComponent: () => import('./features/debate/debate-page').then((m) => m.DebatePage),
    title: 'Debate playground · SentinelAI',
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
    title: 'Account · SentinelAI',
  },
  { path: '**', redirectTo: '' },
];
