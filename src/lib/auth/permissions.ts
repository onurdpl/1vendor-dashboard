export type UserRole = 'admin' | 'vendor' | 'support' | 'finance';

export type Permission =
  | 'orders:read'
  | 'orders:write'
  | 'returns:read'
  | 'returns:write'
  | 'finance:read'
  | 'finance:write'
  | 'automation:read'
  | 'automation:write';

const rolePermissions: Record<UserRole, readonly Permission[]> = {
  admin: [
    'orders:read',
    'orders:write',
    'returns:read',
    'returns:write',
    'finance:read',
    'finance:write',
    'automation:read',
    'automation:write',
  ],
  vendor: ['orders:read', 'returns:read', 'finance:read', 'automation:read'],
  support: ['orders:read', 'returns:read', 'returns:write', 'automation:read'],
  finance: ['finance:read', 'finance:write', 'orders:read', 'returns:read'],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function getDefaultRole(): UserRole {
  return 'admin';
}
