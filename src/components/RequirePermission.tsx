import type { ReactNode } from 'react';
import { DataStatePanel } from './DataStatePanel';
import { getCurrentUser, getCurrentUserRole, hasPermission, type Permission } from '../lib/auth';

type RequirePermissionProps = {
  permission: Permission;
  children: ReactNode;
};

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const currentUser = getCurrentUser();
  const currentRole = getCurrentUserRole();

  if (!currentUser || !hasPermission(currentRole, permission)) {
    return (
      <DataStatePanel
        tone="info"
        eyebrow="Access Control"
        title="Access denied"
        description="Your current role can sign in, but it cannot open this operational area."
        actionLabel="Back to dashboard"
        actionTo="/"
      />
    );
  }

  return children;
}
