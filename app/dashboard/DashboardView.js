'use client';

import { canCompleteChecklist } from '../../modules/checklists/checklist-permissions.mjs';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '../../components/AppShell';
import { Icon } from '../../components/Icons';
import { ClearFiltersButton, FilterSelect, InlineError, ListEmpty, ListGroup, ListSkeleton, StatStrip, Surface, SurfaceHeader, Toolbar, ToolbarSearch } from '../../components/Workflow';
import { markWorkItemCompleted, WorkColumnsHeader, WorkItemRow } from '../../components/WorkList';
import { Button } from '@/components/ui/button';
import { getCurrentEmployee, peekCurrentEmployee } from '../../modules/identity/auth';
import { ensureChecklistGeneratedToday, setChecklistCompletion } from '../../modules/checklists/checklist-actions';
import { peekQuery, queryKey, setQuery } from '../../lib/query-cache';
import { isFreshRender } from '../../lib/render-freshness';
import { loadDashboardData } from '../../modules/work/dashboard';
import { startDashboardAutoRefresh } from '../../modules/work/dashboard-refresh.mjs';
import { canCompleteTask, setTaskCompletion } from '../../modules/tasks/task-data';
import { getWorkItemStatus, sortWorkItemsChronologically } from '../../modules/work-model/work-items.mjs';
import { ProofDialog, ProofPrompt } from '../../components/TaskProof';
import { isProofRequiredError } from '../../modules/work/task-proofs';

const DASHBOARD_PAGE = 20;

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardView({ initialData }) {
  const [data, setData] = useState(() => initialData || peekQuery(queryKey('dashboard', peekCurrentEmployee()?.employee?.id)) || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [completing, setCompleting] = useState(null);
  const [justCompleted, setJustCompleted] = useState(null);
  const [proofTarget, setProofTarget] = useState(null);
  const [requiredProof, setRequiredProof] = useState(null);
  const [visibleCount, setVisibleCount] = useState({ overdue: DASHBOARD_PAGE, pending: DASHBOARD_PAGE, completed: DASHBOARD_PAGE });
  const abortRef = useRef(null);

  const load = useCallback(async ({ background = false } = {}) => {
    if (background && abortRef.current) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!background) {
      setLoading(true);
      setError('');
    }
    try {
      const { employee, error: employeeError } = await getCurrentEmployee();
      if (controller.signal.aborted) return;
      if (employeeError || !employee) throw new Error('Unable to load your workspace profile. Please try again.');
      const response = await loadDashboardData({ employee, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.error) throw response.error;
      setQuery(queryKey('dashboard', employee.id), response.data);
      setData(response.data);
    } catch (error) {
      if (!background && !controller.signal.aborted) setError(error?.message || 'Unable to load dashboard data. Please try again.');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        if (!background && !controller.signal.aborted) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    // Server-rendered data is fresh; only fetch when the page arrived without it.
    if (initialData) setQuery(queryKey('dashboard', initialData.employeeId), initialData);
    if (!isFreshRender(initialData)) load();
    // The daily cron can miss a day; the first visit fills in today's checklist, then reloads.
    ensureChecklistGeneratedToday().then((response) => { if (active && response?.created > 0) load(); }).catch(() => {});
    return () => {
      active = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEa = data?.role === 'ea';
  useEffect(() => {
    if (!isEa || completing) return;
    return startDashboardAutoRefresh(() => load({ background: true }));
  }, [isEa, completing, load]);

  const manager = Boolean(data && ['super_admin', 'assigner', 'ea'].includes(data.role));

  const metrics = data?.metrics || {};
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible = (items) => sortWorkItemsChronologically((items || []).filter((task) => {
      const searchable = [task.title, task.description, task.assignee?.name, task.assignee?.email, task.category].filter(Boolean).join(' ').toLowerCase();
      return (!query || searchable.includes(query))
        && (employeeFilter === 'all' || task.assignee_id === employeeFilter)
        && (typeFilter === 'all' || task.kind === typeFilter)
        && (priorityFilter === 'all' || (task.priority || 'normal') === priorityFilter);
    }));
    const today = { overdue: [], pending: [], completed: [] };
    visible(data?.todayItems).forEach((task) => today[getWorkItemStatus(task)]?.push(task));
    return today;
  }, [data, employeeFilter, priorityFilter, search, typeFilter]);
  const filtersActive = Boolean(search.trim() || employeeFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all');

  function clearFilters() { setSearch(''); setEmployeeFilter('all'); setTypeFilter('all'); setPriorityFilter('all'); }

  async function completeChecklist(workItem) {
    if (completing) return;
    abortRef.current?.abort();
    setLoading(false);
    setCompleting(workItem.id);
    setError('');
    const swap = (replacement) => (item) => (item.kind === workItem.kind && item.id === workItem.id ? replacement(item) : item);
    const mapGroups = (replacement) => setData((current) => ({ ...current, todayItems: current.todayItems.map(swap(replacement)) }));
    mapGroups(markWorkItemCompleted);
    const { error: updateError } = await (workItem.kind === 'checklist' ? setChecklistCompletion(workItem.id) : setTaskCompletion(workItem.id, true));
    // Revert just this row so a refresh that landed meanwhile is not thrown away.
    if (updateError) { mapGroups(() => workItem); if (isProofRequiredError(updateError)) { setJustCompleted(null); setRequiredProof({ kind: workItem.kind, id: workItem.id, title: workItem.title }); } else setError(updateError.message); }
    else setJustCompleted({ kind: workItem.kind, id: workItem.id, title: workItem.title });
    setCompleting(null);
    if (!updateError) load();
  }

  const renderRow = (task) => <WorkItemRow key={`${task.kind}-${task.id}`} workItem={task} showAssignee={manager} canComplete={task.kind === 'fms' ? false : task.kind === 'checklist' ? canCompleteChecklist(data.role, data.employeeId, task.assignee_id) : canCompleteTask(data.employeeId, task.assignee_id)} completing={completing} onComplete={completeChecklist} />;

  return <AppShell
    title={data ? (manager ? 'Dashboard' : 'My work') : 'Dashboard'}
    description={data ? <span suppressHydrationWarning>{greeting()}, {data.name}. Here is your work for today.</span> : 'Loading your workspace…'}
    actions={null}>
    <StatStrip items={[
      { label: 'Total', value: data ? metrics.total : null, icon: 'clipboard', href: '/tasks' },
      { label: 'Pending', value: data ? metrics.pending : null, status: 'pending', href: '/tasks?status=pending' },
      { label: 'Overdue', value: data ? metrics.overdue : null, status: 'overdue', tone: 'danger', href: '/tasks?status=overdue' },
      { label: 'Completed', value: data ? metrics.completed : null, status: 'completed', href: '/tasks?status=completed' },
    ]} />
    <ProofPrompt target={justCompleted} onAdd={() => setProofTarget(justCompleted)} onDismiss={() => setJustCompleted(null)} />
    <Surface>
      <SurfaceHeader title="Today" description="Due today, plus open tasks from other days." actions={<>
        <Button asChild variant="outline" size="sm" className="h-8"><Link href="/follow-up-tasks"><Icon name="calendar" size={14} />Follow-ups</Link></Button>
        <Button asChild variant="ghost" size="sm" className="h-8 text-brand"><Link href="/tasks">All work<Icon name="arrowUpRight" size={14} /></Link></Button>
      </>} />
      <Toolbar search={manager ? <ToolbarSearch value={search} onChange={setSearch} placeholder="Search today's work or people" /> : null}>
        {manager && <FilterSelect label="Person" value={employeeFilter} onChange={setEmployeeFilter}><option value="all">Anyone</option>{(data?.employees || []).map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</FilterSelect>}
        <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter}><option value="all">All work</option><option value="task">Tasks</option><option value="checklist">Checklist</option>{!manager && <option value="fms">FMS</option>}</FilterSelect>
        <FilterSelect label="Priority" value={priorityFilter} onChange={setPriorityFilter}><option value="all">Any</option><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option></FilterSelect>
        <ClearFiltersButton visible={filtersActive} onClick={clearFilters} />
      </Toolbar>
      <InlineError message={error} onRetry={() => load()} />
      {!data && loading ? <ListSkeleton /> : <>
        <WorkColumnsHeader showPerson={manager} />
        {[['overdue', 'Overdue', true], ['pending', 'Pending', false], ['completed', 'Completed', false]].map(([status, title, open]) => groups[status].length > 0 && <ListGroup key={status} status={status} title={title} count={groups[status].length} defaultOpen={open}>{groups[status].slice(0, visibleCount[status]).map(renderRow)}{groups[status].length > visibleCount[status] && <li className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-4 py-2 text-[14px] text-muted-foreground"><span className="tabular-nums">Showing {visibleCount[status]} of {groups[status].length}</span><Button variant="outline" size="sm" className="h-8" onClick={() => setVisibleCount((current) => ({ ...current, [status]: current[status] + DASHBOARD_PAGE }))}>Show {Math.min(DASHBOARD_PAGE, groups[status].length - visibleCount[status])} more</Button></li>}</ListGroup>)}
        {data && !groups.overdue.length && !groups.pending.length && !groups.completed.length && <ListEmpty title={filtersActive ? 'Nothing matches these filters' : 'Nothing scheduled for today'} description={filtersActive ? 'Try a different search or clear the filters.' : 'Work due today will show up here.'} action={filtersActive ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : null} />}
      </>}
    </Surface>
    <ProofDialog target={proofTarget} mode="attach" onClose={() => setProofTarget(null)} onDone={() => { setProofTarget(null); setJustCompleted(null); }} />
    <ProofDialog target={requiredProof} mode="complete" required onClose={() => setRequiredProof(null)} onDone={() => { setRequiredProof(null); load(); }} />
  </AppShell>;
}
