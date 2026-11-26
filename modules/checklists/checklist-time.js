import { getNextBusinessDate, workspaceTimeZone } from '../../lib/business-time.js';

const nextDueSearchDays = 400;

export function isChecklistDueOnDate(template, dateValue) {
  if (!template?.start_date || dateValue < template.start_date) return false;
  const [year, month, day] = String(dateValue).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (template.frequency === 'daily') return true;
  if (template.frequency === 'weekly') return date.getUTCDay() === Number(template.weekday);
  if (template.frequency === 'monthly') {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthlyDays = Array.isArray(template.monthly_days) && template.monthly_days.length ? template.monthly_days : [template.day_of_month];
    return monthlyDays.some((monthlyDay) => day === Math.min(Number(monthlyDay), lastDay));
  }
  if (template.frequency !== 'every_15_days') return false;
  const [startYear, startMonth, startDay] = String(template.start_date).split('-').map(Number);
  const startDate = Date.UTC(startYear, startMonth - 1, startDay);
  return Math.round((date.getTime() - startDate) / 86400000) % 15 === 0;
}

// Items on Sundays, holidays and leave are generated deactivated. Non-daily ones can return as follow-ups, which this does not count.
export function getNextChecklistDueDate(template, fromDate, nonWorkingDates = new Set()) {
  let date = template.start_date > fromDate ? template.start_date : fromDate;
  for (let day = 0; date && day < nextDueSearchDays; day += 1) {
    const sunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
    if (!sunday && !nonWorkingDates.has(date) && isChecklistDueOnDate(template, date)) return date;
    date = getNextBusinessDate(date);
  }
  return null;
}

export function formatChecklistDate(dateValue, today) {
  if (!dateValue) return 'No upcoming date';
  if (dateValue === today) return 'Today';
  if (dateValue === getNextBusinessDate(today)) return 'Tomorrow';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(`${dateValue}T00:00:00Z`));
  const { weekday, day, month } = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${weekday}, ${day} ${month}`;
}

export function formatChecklistDueAt(value, { timeZone = workspaceTimeZone, includeYear = false } = {}) {
  if (!value) return 'No due date';
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) return 'No due date';
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(dueAt);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(dueAt);
  return `${date} · ${time}`;
}

export function formatChecklistTime(value) {
  if (!value) return 'Time not specified';
  const [hour, minute] = String(value).split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return 'Time not specified';
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute));
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(date);
}
