/**
 * Production build configuration. Swapped in for environment.ts by the
 * `fileReplacements` entry on angular.json's production configuration.
 *
 * `apiBaseUrl` is absolute here, unlike the same-origin default: proxy.conf.json
 * only exists for `ng serve`, so a deployed bundle has nothing forwarding /v1 and
 * must address the backend directly. That makes the call cross-origin, which is
 * why the API carries this host in Cors:AllowedOrigins.
 */
export const environment = {
  apiBaseUrl: 'https://sentinelaiapi-app-20260818105221.orangemeadow-4eb00442.swedencentral.azurecontainerapps.io',

  useDemoData: false,
};
