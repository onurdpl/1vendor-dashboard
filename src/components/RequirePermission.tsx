import type { ReactNode } from 'react';
import { DataStatePanel } from './DataStatePanel';
import { getCurrentUser, hasPermission, type Permission } from '../lib/auth';

type RequirePermissionProps = {
  permission: Permission;
  children: ReactNode;
};

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const currentUser = getCurrentUser();

  if (!currentUser || !hasPermission(currentUser.role, permission)) {
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
