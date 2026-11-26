'use client';

import { supabaseBrowser } from '../../lib/supabase-browser';
import { getAccessToken } from '../identity/auth';
import { getBusinessDate } from './checklist-data';

export async function setChecklistCompletion(id, completed = true) {
  let accessToken = await getAccessToken();
  if (!accessToken) return { data: null, error: new Error('Your session has expired. Please sign in again.') };
  const completeRequest = (token) => fetch(`/api/checklist/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ completed }),
  });
  let response = await completeRequest(accessToken);
  if (response.status === 401) {
    accessToken = await getAccessToken({ forceRefresh: true });
    if (accessToken) response = await completeRequest(accessToken);
  }
  if (response.status === 401) {
    return { data: null, error: new Error('Your session has expired. Please sign in again.') };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { data: null, error: Object.assign(new Error(payload.error || `The checklist item could not be ${completed ? 'completed' : 'reopened'}.`), payload.code ? { hint: payload.code } : {}) };
  return { data: payload.item || null, error: null, alreadyCompleted: payload.alreadyCompleted === true, alreadyReopened: payload.alreadyReopened === true };
}

export async function addChecklistItemUpdate(itemId, authorUserId, remark) {
  return supabaseBrowser()
    .from('checklist_item_updates')
    .insert({ checklist_item_id: itemId, author_user_id: authorUserId, update_type: 'remark', remark: remark.trim() });
}

export async function triggerChecklistGeneration() {
  const accessToken = await getAccessToken();
  if (!accessToken) return { success: false, error: 'Your session has expired. Please sign in again.' };
  const response = await fetch('/api/checklist/generate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { success: false, error: payload.error || 'Checklist generation failed.' };
  return { success: payload.success !== false, ...payload };
}

const GENERATED_ON_KEY = 'dl_checklist_generated_on';

// Page visits only need generation once per business day per browser; template saves
// still call triggerChecklistGeneration directly, and the daily cron covers the rest.
export async function ensureChecklistGeneratedToday() {
  const today = getBusinessDate();
  try {
    if (window.localStorage.getItem(GENERATED_ON_KEY) === today) return { success: true, created: 0, skipped: true };
  } catch { /* storage unavailable: just generate */ }
  const response = await triggerChecklistGeneration();
  if (response?.success) {
    try { window.localStorage.setItem(GENERATED_ON_KEY, today); } catch { /* ignore */ }
  }
  return response;
}
