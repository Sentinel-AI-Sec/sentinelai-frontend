import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth-guard';
import { areaGuard } from './core/auth/role-guard';

/**
 * `/`, `/login` and `/reports/:id` are the original SEC-42 read-only surface — no route there
 * starts a scan or changes anything. Everything below `/projects` is the ops/admin surface added
 * on top of it: submitting a scan, driving its stages, running a debate directly, and account
 * management. Each of those screens gates its own write actions on the signed-in role/scope
 * (the backend enforces the same checks; the UI gate exists so someone without permission sees
 * why, rather than a raw 403).
 *
 * Routes that not every role holds carry `areaGuard` alongside `authGuard`, in that order —
 * signed out you get the login redirect and your `returnUrl`; signed in as the wrong role you get
 * the dashboard. The guard and the side navigation read the same table in `core/auth/roles.ts`,
 * so a link that is hidden is also unreachable by URL, and neither can drift from the other.
 *
 * `/scans/:id/graph` and `/scans/:id/findings` are read-only views of the two SEC-40 endpoints
 * that had no screen at all before — the resource graph and the findings page. They sit under
 * the scan rather than beside it because neither means anything without one: a graph is always
 * *this* scan's graph.
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
    canActivate: [authGuard, areaGuard('projects')],
    loadComponent: () => import('./features/projects/projects-page').then((m) => m.ProjectsPage),
    title: 'Projects · SentinelAI',
  },
  {
    // The three values a repository needs before the Action can scan it: the API URL, a project
    // id, and a machine token. Sits beside /projects rather than under it because two of the
    // three are not about any one project.
    path: 'setup',
    canActivate: [authGuard, areaGuard('setup')],
    loadComponent: () => import('./features/setup/setup-page').then((m) => m.SetupPage),
    title: 'Set up CI · SentinelAI',
  },
  {
    // Declared before 'scans/new' only for readability — the two cannot collide, since every
    // route below is matched on segment count and literal first.
    path: 'scans',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/scans/scan-history-page').then((m) => m.ScanHistoryPage),
    title: 'Scan history · SentinelAI',
  },
  {
    // Kept, but off the navigation, closed to `user` by the guard, and gated again on admin
    // inside the component. Scans are started by the Action; this is the by-hand equivalent, for
    // driving the pipeline without a CI run.
    path: 'scans/new',
    canActivate: [authGuard, areaGuard('newScan')],
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
    // Chains belong to the SCAN, not to a report — so they are reachable even where retention was
    // declined and no audit was kept. Until this route existed they were not.
    path: 'scans/:id/chains',
    canActivate: [authGuard],
    loadComponent: () => import('./features/scans/chains-page').then((m) => m.ChainsPage),
    title: 'Exploit chains · SentinelAI',
  },
  {
    path: 'scans/:id/graph',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/scans/resource-graph-page').then((m) => m.ResourceGraphPage),
    title: 'Resource graph · SentinelAI',
  },
  {
    path: 'scans/:id/findings',
    canActivate: [authGuard],
    loadComponent: () => import('./features/scans/findings-page').then((m) => m.FindingsPage),
    title: 'Findings · SentinelAI',
  },
  {
    path: 'debate',
    canActivate: [authGuard, areaGuard('debate')],
    loadComponent: () => import('./features/debate/debate-page').then((m) => m.DebatePage),
    title: 'Debate playground · SentinelAI',
  },
  {
    // The one screen behind no guard. Someone deciding whether to sign up has to be able to
    // read what it costs, and a pricing page that bounces to /login is a pricing page nobody
    // reads.
    path: 'pricing',
    loadComponent: () => import('./features/pricing/pricing-page').then((m) => m.PricingPage),
    title: 'Pricing · SentinelAI',
  },
  {
    path: 'billing',
    canActivate: [authGuard],
    loadComponent: () => import('./features/billing/billing-page').then((m) => m.BillingPage),
    title: 'Billing · SentinelAI',
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
    title: 'Account · SentinelAI',
  },
  { path: '**', redirectTo: '' },
];
