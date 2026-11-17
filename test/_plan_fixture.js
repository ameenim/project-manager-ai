'use strict';
// A small plan workbook: a WBS table, a colored month grid sheet and a risk sheet.
const XLSX = require('xlsx');

const serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
function workbook() {
  const wb = XLSX.utils.book_new();
  const plan = [
    ['ACME MINISTRY'],
    ['WBS', 'Task Name', 'Type', 'Track', 'Start', 'Finish (Baseline)', 'Owner', 'Status', '% Complete', 'Notes / Dependencies'],
    ['0', 'ACME Implementation', 'Project', 'Both', serial('2026-04-26'), serial('2027-12-23'), '', 'On Track', '', ''],
    ['1', 'Initiation', 'Phase', 'Both', serial('2026-04-26'), serial('2026-05-28'), 'PM', 'Complete', 1, ''],
    ['1.1', '    Contract award received', 'Milestone', 'Both', serial('2026-04-26'), serial('2026-04-26'), 'PM', 'Complete', 1, ''],
    ['1.2', '    Collect business documents', 'Task', 'Both', serial('2026-04-26'), serial('2026-04-28'), 'PM', 'Complete', 1, 'Line one\nline two'],
    ['2', 'Analysis', 'Phase', 'Both', serial('2026-05-31'), serial('2026-07-30'), 'PM', 'In progress', 0.5, ''],
    ['2.1', '    Tawasol Requirements Analysis Sign-Off', 'Milestone', 'Tawasol', serial('2026-06-10'), serial('2026-06-10'), 'MSY', 'Complete', 1, 'Client sign-off gate'],
    ['2.2', '    ICN Requirements Analysis Sign-Off', 'Milestone', 'ICN', serial('2026-07-09'), serial('2026-07-09'), 'MSY', 'Planned', 0, 'Client sign-off gate'],
    ['2.3', '    Analysis Sign-Off', 'Sub-Phase', 'Both', serial('2026-07-12'), serial('2026-07-23'), 'PM', 'Planned', 0, ''],
    ['2.3.1', '        Analysis Sign-Off', 'Milestone', 'Both', serial('2026-07-13'), serial('2026-07-13'), 'MSY', 'Planned', 0, ''],
    ['2.3.2', '        Close analysis', 'Task', 'Both', serial('2026-07-14'), serial('2026-07-15'), 'PM', 'Planned', 0, ''],
    ['3', 'Governance', 'Phase', 'Both', serial('2026-04-26'), serial('2027-12-23'), 'PM', 'Active', 0.4, ''],
    ['3.1', '    Weekly status meeting', 'Continuous', 'Both', serial('2026-05-03'), serial('2027-12-23'), 'PM', 'Active', 0.4, ''],
    ['3.2', '    Weekly status meeting', 'Continuous', 'Both', serial('2026-05-04'), serial('2027-12-22'), 'PM', 'Active', 0.4, ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(plan);
  for (let r = 2; r < plan.length; r++) for (const c of [4, 5]) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = 'dd-mmm-yy'; }
  XLSX.utils.book_append_sheet(wb, ws, 'Project Plan');
  const grid = XLSX.utils.aoa_to_sheet([['ROADMAP'], ['WBS', 'Key Milestone', 'May', 'Jun', 'Jul'], ['1', 'Initiation', '', '', ''], ['2', 'Analysis', '', '', '']]);
  XLSX.utils.book_append_sheet(wb, grid, 'Roadmap');
  const risks = XLSX.utils.aoa_to_sheet([
    ['KEY DEPENDENCIES AND RISKS'], [],
    ['', 'ID', 'Dependency / Risk', 'Impact', 'Probability', 'Owner', 'Status', 'Mitigation / Action Required'],
    ['', 'R-01', 'Client prerequisites: Active Directory and connectivity items remain open, holding infrastructure sign-off.', 'High', 'Medium', 'MSY IT', 'Closed', 'Weekly joint review until closure.'],
    ['', 'R-02', 'New feature scope: design is concluding while development has started.', 'Medium', 'Medium', 'Joint', 'Open', 'Design frozen at sign-off.'],
    ['', 'D-01', 'Dependency: client cybersecurity clearance is required again before production go-live.', 'Medium', 'Low', 'MSY IT', 'Monitored', 'Production security review booked.'],
  ]);
  XLSX.utils.book_append_sheet(wb, risks, 'Dependencies & Risks');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { workbook };
