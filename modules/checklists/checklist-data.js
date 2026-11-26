import { formatChecklistDueAt, formatChecklistTime } from './checklist-time';
import { workspaceTimeZone, getWorkspaceDate } from '../../lib/business-time';
import { getUnifiedWorkItemStatus } from '../work-model/work-summary.mjs';

export const checklistWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const checklistFrequencies = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'every_15_days', label: 'Every 15 days' },
  { value: 'monthly', label: 'Monthly' },
];

export function getChecklistTimeZone() {
  return process.env.NEXT_PUBLIC_CHECKLIST_TIMEZONE || workspaceTimeZone;
}

export function getBusinessDate(value = new Date()) {
  return getWorkspaceDate(value, getChecklistTimeZone());
}

export { formatChecklistDueAt, formatChecklistTime };

export function formatEmployeeId(id) {
  return id ? `EMP-${id.slice(0, 6).toUpperCase()}` : '—';
}

export function formatChecklistDays(template) {
  if (template.frequency === 'daily') return 'Daily';
  if (template.frequency === 'weekly') return `Every ${checklistWeekdays[template.weekday] || 'week'}`;
  if (template.frequency === 'every_15_days') return 'Every 15 days';
  const days = template.monthly_days?.length ? template.monthly_days : [template.day_of_month];
  return `Monthly on the ${days.map((day) => `${day}${[11, 12, 13].includes(Number(day)) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[Number(day) % 10] || 'th')}`).join(' & ')}`;
}

export function getChecklistStatus(item, now = new Date()) {
  return getUnifiedWorkItemStatus(item, now, 'checklist');
}
