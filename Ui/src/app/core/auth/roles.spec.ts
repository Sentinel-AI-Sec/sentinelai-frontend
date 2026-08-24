import { describe, expect, it } from 'vitest';

import { Area, UiRole, canSee, toUiRole } from './roles';

/**
 * The permission table, pinned.
 *
 * Written as an explicit grid rather than as assertions derived from `AreaAccess`, because a
 * test that recomputes the thing it is testing passes no matter what the table says. This one
 * fails if the table changes, which is the point — the three roles are a product decision, and
 * silently widening one should not be possible without a diff that says so.
 */
describe('console roles', () => {
  describe('translating the backend claim', () => {
    it('maps the roles the backend actually issues', () => {
      expect(toUiRole('admin')).toBe('admin');
      expect(toUiRole('analyst')).toBe('dev');
      expect(toUiRole('viewer')).toBe('user');
    });

    it('accepts the console names too, so it survives the backend adopting them', () => {
      expect(toUiRole('admin')).toBe('admin');
      expect(toUiRole('dev')).toBe('dev');
      expect(toUiRole('user')).toBe('user');
    });

    it('grants the minimum for a claim it does not recognise, or none at all', () => {
      // A machine token carries no role claim; an unknown string is a build older than the
      // backend. Neither should be handed anything on the strength of being unfamiliar.
      expect(toUiRole(null)).toBe('user');
      expect(toUiRole(undefined)).toBe('user');
      expect(toUiRole('')).toBe('user');
      expect(toUiRole('superintendent')).toBe('user');
      expect(toUiRole('Admin')).toBe('user');
    });
  });

  describe('what each role reaches', () => {
    const areas: Area[] = [
      'dashboard',
      'projects',
      'setup',
      'scans',
      'newScan',
      'debate',
      'billing',
      'account',
    ];

    const expected: Record<UiRole, Area[]> = {
      user: ['dashboard', 'scans', 'billing', 'account'],
      admin: ['dashboard', 'projects', 'setup', 'scans', 'newScan', 'billing', 'account'],
      dev: ['dashboard', 'projects', 'setup', 'scans', 'newScan', 'debate', 'billing', 'account'],
    };

    for (const role of Object.keys(expected) as UiRole[]) {
      it(`${role} sees exactly what it should`, () => {
        const reachable = areas.filter((area) => canSee(role, area));
        expect(reachable).toEqual(expected[role]);
      });
    }

    it('gives the debate playground to dev alone', () => {
      expect(canSee('dev', 'debate')).toBe(true);
      expect(canSee('admin', 'debate')).toBe(false);
      expect(canSee('user', 'debate')).toBe(false);
    });

    it('keeps a user away from anything that outlives their session', () => {
      // Registering a project and minting a machine token both leave something behind after
      // sign-out, which is the line this role sits on the far side of.
      expect(canSee('user', 'projects')).toBe(false);
      expect(canSee('user', 'setup')).toBe(false);
      expect(canSee('user', 'newScan')).toBe(false);
    });

    it('gives every role the screens that are about them', () => {
      for (const role of ['user', 'admin', 'dev'] as UiRole[]) {
        expect(canSee(role, 'dashboard')).toBe(true);
        expect(canSee(role, 'account')).toBe(true);
        expect(canSee(role, 'billing')).toBe(true);
        expect(canSee(role, 'scans')).toBe(true);
      }
    });
  });
});
