import { describe, expect, it } from 'vitest';
import { obtainAttrsPaths } from './sql.util.js';

describe('sql.util extras', () => {
  it('obtainAttrsPaths should handle nested objects with depth', () => {
    const res = obtainAttrsPaths({
      'user.profile.name': 1,
      'user.email': 1,
      user_profile_name: 1,
    });
    expect(res).toEqual({
      'user.profile.name': ['user', 'profile', 'name'],
      'user.email': ['user', 'email'],
      user_profile_name: ['user', 'profile', 'name'],
    });
  });
});
