import { done, fail } from '../../lib/actor';
import { canManageWork } from '../identity/roles.mjs';
import { createServerNotifications, notificationFingerprint } from '../notifications/notifications-server';
import { buildChecklistTemplateKey, templateFrequencies } from './checklist-template-record.mjs';

const frequencyValues = new Set(templateFrequencies);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()); }
function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function cleanDays(value) { return [...new Set((Array.isArray(value) ? value : []).map(Number))].sort((left, right) => left - right); }

function selectedTemplateIds(payload) {
  return Array.isArray(payload?.ids) ? [...new Set(payload.ids.filter((id) => typeof id === 'string' && uuidPattern.test(id)))] : [];
}

export async function updateTemplatesInBulk(admin, actor, payload) {
  if (!canManageWork(actor.role)) return fail('You do not have permission to manage checklists.', 403);
  const ids = selectedTemplateIds(payload);
  const changes = payload?.changes && typeof payload.changes === 'object' ? payload.changes : {};
  if (!ids.length || !Object.keys(changes).length) return fail('Select at least one template and one field to change.', 400);
  const allowedFields = new Set(['employee_id', 'task', 'frequency', 'weekday', 'day_of_month', 'monthly_days', 'due_time', 'start_date', 'active', 'proof_required']);
  if (Object.keys(changes).some((field) => !allowedFields.has(field))) return fail('The bulk edit contains an unsupported field.', 400);

  const { data: templates, error: templateError } = await admin.from('checklist_templates').select('id,employee_id,task,frequency,weekday,day_of_month,monthly_days,start_date,due_time,active').in('id', ids);
  if (templateError) return fail('The selected checklist templates could not be loaded.', 500);
  if ((templates || []).length !== ids.length) return fail('One or more selected checklist templates were not found.', 404);

  if (Object.prototype.hasOwnProperty.call(changes, 'employee_id')) {
    if (!uuidPattern.test(changes.employee_id)) return fail('Choose a valid employee.', 400);
    const { data: employee } = await admin.from('employees').select('id').eq('id', changes.employee_id).eq('active', true).maybeSingle();
    if (!employee) return fail('Choose an active existing employee.', 400);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'task') && (typeof changes.task !== 'string' || !changes.task.trim() || changes.task.trim().length > 240)) return fail('Task must be between 1 and 240 characters.', 400);
  if (Object.prototype.hasOwnProperty.call(changes, 'frequency') && !frequencyValues.has(changes.frequency)) return fail('Choose a supported recurrence.', 400);
  if (Object.prototype.hasOwnProperty.call(changes, 'due_time') && !validTime(changes.due_time)) return fail('Due time must be between 00:00 and 23:59.', 400);
  if (Object.prototype.hasOwnProperty.call(changes, 'start_date') && !validDate(changes.start_date)) return fail('Start date must be a valid date.', 400);
  if (Object.prototype.hasOwnProperty.call(changes, 'active') && typeof changes.active !== 'boolean') return fail('Active status must be true or false.', 400);
  if (Object.prototype.hasOwnProperty.call(changes, 'proof_required') && typeof changes.proof_required !== 'boolean') return fail('Choose whether proof is mandatory or optional.', 400);

  const normalizedChanges = { ...changes };
  if (Object.prototype.hasOwnProperty.call(normalizedChanges, 'task')) normalizedChanges.task = normalizedChanges.task.trim();
  if (Object.prototype.hasOwnProperty.call(normalizedChanges, 'monthly_days')) normalizedChanges.monthly_days = cleanDays(normalizedChanges.monthly_days);
  if (Object.prototype.hasOwnProperty.call(normalizedChanges, 'frequency')) {
    if (normalizedChanges.frequency === 'weekly') {
      if (!Number.isInteger(Number(normalizedChanges.weekday)) || Number(normalizedChanges.weekday) < 0 || Number(normalizedChanges.weekday) > 6) return fail('Choose a weekday for weekly recurrence.', 400);
      normalizedChanges.weekday = Number(normalizedChanges.weekday);
      normalizedChanges.day_of_month = null;
      normalizedChanges.monthly_days = [];
    } else if (normalizedChanges.frequency === 'monthly') {
      const days = cleanDays(normalizedChanges.monthly_days || [normalizedChanges.day_of_month]);
      if (!days.length || days.some((day) => !Number.isInteger(day) || day < 1 || day > 31)) return fail('Choose one or more valid monthly days.', 400);
      normalizedChanges.monthly_days = days;
      normalizedChanges.day_of_month = days[0];
      normalizedChanges.weekday = null;
    } else {
      normalizedChanges.weekday = null;
      normalizedChanges.day_of_month = null;
      normalizedChanges.monthly_days = [];
    }
  }

  const nextTemplates = templates.map((template) => ({ ...template, ...normalizedChanges }));
  for (const template of nextTemplates) {
    if (!frequencyValues.has(template.frequency)) return fail('Choose a supported recurrence.', 400);
    if (template.frequency === 'weekly' && (!Number.isInteger(Number(template.weekday)) || Number(template.weekday) < 0 || Number(template.weekday) > 6)) return fail('Choose a weekday for weekly recurrence.', 400);
    if (template.frequency === 'monthly') {
      const days = cleanDays(template.monthly_days || [template.day_of_month]);
      if (!days.length || days.some((day) => !Number.isInteger(day) || day < 1 || day > 31)) return fail('Choose one or more valid monthly days.', 400);
    }
  }
  // Only fields that make up the duplicate key can create a duplicate (a proof-only change never does).
  const keyFields = ['employee_id', 'task', 'frequency', 'weekday', 'day_of_month', 'monthly_days', 'due_time', 'active'];
  const duplicateKeys = new Set();
  if (keyFields.some((field) => Object.prototype.hasOwnProperty.call(changes, field))) {
    const outsideTemplates = await admin.from('checklist_templates').select('id,employee_id,task,frequency,weekday,day_of_month,monthly_days,due_time,active').eq('active', true).not('id', 'in', `(${ids.join(',')})`);
    if (outsideTemplates.error) return fail('Existing checklist templates could not be checked for duplicates.', 500);
    const outsideKeys = new Set((outsideTemplates.data || []).map(buildChecklistTemplateKey));
    for (const template of nextTemplates) {
      if (!template.active) continue;
      const key = buildChecklistTemplateKey(template);
      if (outsideKeys.has(key) || duplicateKeys.has(key)) return fail('The selected changes would create a duplicate active checklist template.', 409);
      duplicateKeys.add(key);
    }
  }

  const { data: updated, error: updateError } = await admin.from('checklist_templates').update(normalizedChanges).in('id', ids).select('id');
  if (updateError || updated?.length !== ids.length) {
    console.error('Checklist bulk update failed.', { code: updateError?.code, message: updateError?.message });
    return fail('The selected checklist templates could not be updated.', 500);
  }
  const grouped = new Map();
  nextTemplates.forEach((template) => {
    const previous = templates.find((candidate) => candidate.id === template.id);
    const recipientIds = new Set([template.employee_id]);
    if (previous.employee_id !== template.employee_id) recipientIds.add(previous.employee_id);
    recipientIds.forEach((employeeId) => {
      const current = grouped.get(employeeId) || [];
      current.push(template);
      grouped.set(employeeId, current);
    });
  });
  await createServerNotifications(admin, [...grouped.entries()]
    .filter(([employeeId]) => employeeId !== actor.employeeId)
    .map(([employeeId, employeeTemplates]) => ({
      recipient_employee_id: employeeId,
      actor_employee_id: actor.employeeId,
      kind: 'checklist_bulk_updated',
      title: 'Checklist tasks updated',
      body: `${employeeTemplates.length} checklist task${employeeTemplates.length === 1 ? '' : 's'} were updated.`,
      entity_type: 'checklist_template',
      entity_id: employeeTemplates[0].id,
      dedupe_key: `checklist_bulk_updated:${notificationFingerprint([...ids].sort(), JSON.stringify(normalizedChanges))}:${employeeId}`,
    })));
  return done({ success: true, updated: updated.length });
}

export async function deleteTemplatesInBulk(admin, actor, payload) {
  if (!canManageWork(actor.role)) return fail('You do not have permission to manage checklists.', 403);
  const ids = selectedTemplateIds(payload);
  if (!ids.length) return fail('Select at least one checklist template.', 400);
  const { data: templates, error: loadError } = await admin.from('checklist_templates').select('id,employee_id,task,active').in('id', ids);
  if (loadError || (templates || []).length !== ids.length) return fail('One or more selected checklist templates were not found.', 404);
  const { count: generatedItemCount, error: generatedItemCountError } = await admin
    .from('checklist_items')
    .select('id', { count: 'exact', head: true })
    .in('template_id', ids);
  if (generatedItemCountError) {
    console.error('Generated checklist item count before bulk deletion failed.', { code: generatedItemCountError.code, message: generatedItemCountError.message });
    return fail('The generated checklist items could not be checked before deletion.', 500);
  }

  const { error: generatedItemDeleteError } = await admin.from('checklist_items').delete().in('template_id', ids);
  if (generatedItemDeleteError) {
    console.error('Generated checklist bulk deletion failed.', { code: generatedItemDeleteError.code, message: generatedItemDeleteError.message });
    return fail('The selected checklist tasks could not be deleted because their generated items could not be removed.', 409);
  }

  const { data: deleted, error } = await admin.from('checklist_templates').delete().in('id', ids).select('id');
  if (error || deleted?.length !== ids.length) {
    console.error('Checklist bulk delete failed.', { code: error?.code, message: error?.message });
    return fail('The selected checklist templates could not be deleted.', 500);
  }
  const grouped = new Map();
  (templates || []).filter((template) => template.active).forEach((template) => {
    const current = grouped.get(template.employee_id) || [];
    current.push(template);
    grouped.set(template.employee_id, current);
  });
  await createServerNotifications(admin, [...grouped.entries()]
    .filter(([employeeId]) => employeeId !== actor.employeeId)
    .map(([employeeId, employeeTemplates]) => ({
      recipient_employee_id: employeeId,
      actor_employee_id: actor.employeeId,
      kind: 'checklist_deleted',
      title: 'Checklist tasks deleted',
      body: `${employeeTemplates.length} checklist task${employeeTemplates.length === 1 ? '' : 's'} ${employeeTemplates.length === 1 ? 'was' : 'were'} permanently deleted.`,
      entity_type: 'checklist_template',
      entity_id: employeeTemplates[0].id,
      dedupe_key: `checklist_bulk_deleted:${notificationFingerprint([...ids].sort())}:${employeeId}`,
    })));
  return done({ success: true, deleted: deleted.length, generatedItemsDeleted: generatedItemCount || 0 });
}
