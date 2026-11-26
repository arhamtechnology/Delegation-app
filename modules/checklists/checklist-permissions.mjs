const calendarManagerRoles = new Set(['super_admin', 'ea']);
const ownChecklistRoles = new Set(['doer', 'assigner']);

export function canManageCalendar(role) {
  return calendarManagerRoles.has(role);
}

export function canCompleteChecklist(role, employeeId, assignedEmployeeId) {
  return calendarManagerRoles.has(role) || (ownChecklistRoles.has(role) && employeeId === assignedEmployeeId);
}
