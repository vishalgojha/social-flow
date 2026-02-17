import { canPerform, assertRole } from '../src/security/rbac';

describe('rbac', () => {
  it('enforces hierarchy', () => {
    expect(canPerform('owner', 'admin')).toBe(true);
    expect(canPerform('viewer', 'operator')).toBe(false);
  });

  it('throws on insufficient permissions', () => {
    expect(() => assertRole('viewer', 'admin')).toThrow('insufficient_role');
  });
});
