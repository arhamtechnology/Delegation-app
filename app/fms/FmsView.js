'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../../components/AppShell';
import { FilterSelect, InlineError, ListEmpty, ListSkeleton, StatStrip, Surface, SurfaceHeader, Toolbar, ToolbarSearch } from '../../components/Workflow';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getAccessToken } from '../../modules/identity/auth';
import { formatChecklistDueAt } from '../../modules/checklists/checklist-time';

const refreshMs = 60000;
const statusLabels = { pending: 'Pending', overdue: 'Overdue', done: 'Done on time', late: 'Done late' };
const statusTones = {
  pending: 'bg-muted text-foreground',
  overdue: 'bg-destructive/10 text-destructive',
  done: 'bg-brand-soft text-brand-dark',
  late: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
};
const refLabels = { invoice: 'Dispatch', transport: 'Invoice' };

async function api(method, body, process) {
  const token = await getAccessToken();
  const response = await fetch(process ? `/api/fms?process=${encodeURIComponent(process)}` : '/api/fms', {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'FMS request failed.');
  return payload;
}

function StepRow({ step, employees, onSaved }) {
  const [doerId, setDoerId] = useState(step.doer_id || '');
  const [hours, setHours] = useState(String(step.eta_minutes / 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = doerId !== (step.doer_id || '') || Number(hours) * 60 !== step.eta_minutes;
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('PATCH', { process: step.process, code: step.code, doer_id: doerId || null, eta_minutes: Math.round(Number(hours) * 60) });
      await onSaved();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_220px_140px_auto] sm:items-center">
    <span className="text-[14.5px] font-medium">{step.seq}. {step.name}</span>
    <label className="flex items-center gap-2 text-[14px]"><span className="text-muted-foreground sm:sr-only">Doer</span>
      <select className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[14px]" value={doerId} onChange={(event) => setDoerId(event.target.value)} aria-label={`Doer for ${step.name}`}>
        <option value="">Not assigned</option>
        {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
      </select>
    </label>
    <label className="flex items-center gap-2 text-[14px]"><span className="text-muted-foreground">ETA</span>
      <input type="number" min="0.1" max="720" step="0.5" className="h-8 w-20 rounded-md border border-input bg-background px-2 text-[14px]" value={hours} onChange={(event) => setHours(event.target.value)} aria-label={`ETA hours for ${step.name}`} /><span className="text-muted-foreground">h</span>
    </label>
    <Button size="sm" className="h-8" disabled={!changed || busy || !(Number(hours) > 0)} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
    {error && <p className="text-[13px] text-destructive sm:col-span-4" role="alert">{error}</p>}
  </div>;
}

export default function FmsView({ flow, initialData }) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState('');
  const [view, setView] = useState('open');
  const [step, setStep] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api('GET', null, flow.process));
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [flow.process]);

  useEffect(() => {
    if (!initialData) load();
    const timer = window.setInterval(load, refreshMs);
    return () => window.clearInterval(timer);
  }, [initialData, load]);

  const items = useMemo(() => data?.items || [], [data]);
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => (view === 'open' ? ['pending', 'overdue'].includes(item.status) : view === 'overdue' ? item.status === 'overdue' : ['done', 'late'].includes(item.status)))
      .filter((item) => step === 'all' || item.step === step)
      .filter((item) => !query || [item.order_no, item.customer, item.ref].some((value) => value?.toLowerCase().includes(query)))
      .sort((a, b) => (view === 'done' ? Date.parse(b.done_at) - Date.parse(a.done_at) : Date.parse(a.due_at) - Date.parse(b.due_at)));
  }, [items, view, step, search]);

  const finished = items.filter((item) => ['done', 'late'].includes(item.status));
  const onTime = finished.length ? Math.round((100 * finished.filter((item) => item.status === 'done').length) / finished.length) : null;

  return <AppShell title={flow.title} description={flow.description}>
    {!data ? (error ? <Surface><InlineError message={error} onRetry={load} /></Surface> : <ListSkeleton label={`Loading ${flow.title}…`} />) : <>
      <StatStrip items={[
        { label: 'Open', value: items.filter((item) => ['pending', 'overdue'].includes(item.status)).length, status: 'pending' },
        { label: 'Overdue', value: items.filter((item) => item.status === 'overdue').length, status: 'overdue', tone: 'danger' },
        { label: 'Done (7 days)', value: finished.length, status: 'completed' },
        { label: 'On time (7 days)', value: onTime === null ? '–' : `${onTime}%`, icon: 'clock' },
      ]} />

      <Surface>
        <SurfaceHeader title="Steps and doers" description="Changes apply to open work at once. Doers see their steps on their dashboard. EAs get WhatsApp alerts for new work, 30 minutes before the ETA and when overdue; directors also hear 1 hour after the ETA." />
        {data.steps.map((row) => <StepRow key={`${row.process}|${row.code}|${row.doer_id}|${row.eta_minutes}`} step={row} employees={data.employees} onSaved={load} />)}
      </Surface>

      <Surface>
        <InlineError message={error} onRetry={load} />
        <Toolbar search={<ToolbarSearch value={search} onChange={setSearch} placeholder="Search order, customer, invoice" />}>
          <FilterSelect label="Show" value={view} onChange={setView}><option value="open">Open</option><option value="overdue">Overdue</option><option value="done">Done (7 days)</option></FilterSelect>
          <FilterSelect label="Step" value={step} onChange={setStep}><option value="all">All steps</option>{data.steps.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</FilterSelect>
        </Toolbar>
        {!shown.length ? <ListEmpty title={view === 'done' ? 'Nothing finished in the last 7 days' : 'No open work'} description="New work from the ERP appears here within a minute." /> : <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead className="border-b border-border text-[13px] text-muted-foreground"><tr>
              <th className="px-4 py-2 font-medium">Order</th><th className="px-2 py-2 font-medium">Step</th><th className="px-2 py-2 font-medium">Doer</th>
              <th className="px-2 py-2 font-medium">Started</th><th className="px-2 py-2 font-medium">Due</th><th className="px-2 py-2 font-medium">{view === 'done' ? 'Done' : 'Status'}</th>
            </tr></thead>
            <tbody>{shown.map((item) => <tr key={item.key} className="border-b border-border last:border-b-0">
              <td className="px-4 py-2.5"><div className="font-medium">{item.order_no}</div><div className="max-w-[260px] truncate text-[13px] text-muted-foreground">{item.customer}{item.ref && refLabels[item.step] ? ` · ${refLabels[item.step]} ${item.ref}` : ''}</div></td>
              <td className="px-2 py-2.5">{item.stepName}</td>
              <td className="px-2 py-2.5">{item.doerName || <span className="text-muted-foreground">Not assigned</span>}</td>
              <td className="px-2 py-2.5 whitespace-nowrap">{formatChecklistDueAt(item.started_at)}</td>
              <td className="px-2 py-2.5 whitespace-nowrap">{formatChecklistDueAt(item.due_at)}</td>
              <td className="px-2 py-2.5 whitespace-nowrap">
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12.5px] font-medium', statusTones[item.status])}>{statusLabels[item.status]}</span>
                {item.done_at && <div className="text-[12.5px] text-muted-foreground">{formatChecklistDueAt(item.done_at)}</div>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Surface>
    </>}
  </AppShell>;
}
