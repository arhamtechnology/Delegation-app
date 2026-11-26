export const workspaceTimeZone = 'Asia/Kolkata';

export function getDateTimeParts(value, timeZone = workspaceTimeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function getWorkspaceDate(value = new Date(), timeZone = workspaceTimeZone) {
  const parts = getDateTimeParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getTodayInIndia(value = new Date()) {
  return getWorkspaceDate(value, workspaceTimeZone);
}

export function getNextBusinessDate(dateValue) {
  const dateParts = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateParts) return null;
  const date = new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3])));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== Number(dateParts[1]) || date.getUTCMonth() !== Number(dateParts[2]) - 1 || date.getUTCDate() !== Number(dateParts[3])) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return getWorkspaceDate(date, 'UTC');
}

export function localDateTimeToIso(dateValue, timeValue, timeZone = workspaceTimeZone) {
  if (!dateValue || !timeValue) return null;
  const dateMatch = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeValue).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const represented = getDateTimeParts(new Date(localAsUtc), timeZone);
  const representedAsUtc = Date.UTC(
    Number(represented.year),
    Number(represented.month) - 1,
    Number(represented.day),
    Number(represented.hour),
    Number(represented.minute),
    Number(represented.second),
  );
  const offset = representedAsUtc - localAsUtc;
  return new Date(localAsUtc - offset).toISOString();
}
