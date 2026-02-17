import { Role } from '../types/domain';

const rank: Record<Role, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  owner: 4
};

export function canPerform(role: Role, minRole: Role): boolean {
  return rank[role] >= rank[minRole];
}

export function assertRole(role: Role, minRole: Role): void {
  if (!canPerform(role, minRole)) {
    throw Object.assign(new Error(`insufficient_role:${role}`), { statusCode: 403 });
  }
}
