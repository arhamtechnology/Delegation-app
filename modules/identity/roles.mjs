const workManagerRoles = new Set(['super_admin', 'assigner', 'ea']);

export function canManageWork(role) {
  return workManagerRoles.has(role);
}
