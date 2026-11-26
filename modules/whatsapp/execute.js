import { deleteTemplate, createTemplate, updateTemplate } from '../checklists/checklist-template-rules';
import { setChecklistItemCompletion } from '../checklists/checklist-item-rules';
import { configureNonWorkingDays, disableHoliday, removeNonWorkingDay } from '../checklists/non-working-day-rules';
import { deleteTask } from '../tasks/task-rules';
import { executeProposals as run } from './execute-core.mjs';

const rules = { deleteTask, setChecklistItemCompletion, createTemplate, updateTemplate, deleteTemplate, configureNonWorkingDays, removeNonWorkingDay, disableHoliday };

// Confirmed proposals run through the same server rules the app's routes use.
export const executeProposals = (admin, actor, proposals) => run(admin, actor, proposals, rules);
