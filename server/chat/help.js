// Product help the chat can read when someone asks how the platform works. It is the only source for platform
// questions, so answers never invent features. Each topic points to the screen where the person can act.
'use strict';

const TOPICS = [
  { id: 'import_msproject', title: 'Import a Microsoft Project file', screen: 'schedule', keys: ['microsoft project', 'ms project', 'mpp', 'xml', 'import schedule', 'import a schedule'],
    text: 'Open the project, go to the Schedule tab, and use the Microsoft Project option on the Gantt screen. Import reads Microsoft Project XML. Choose Replace to start from the file or Merge to update matching tasks. A preview shows how many tasks are added and updated before anything is saved. Export gives the same XML back.' },
  { id: 'export_schedule', title: 'Export the schedule or a project backup', screen: 'settings', keys: ['export', 'download schedule', 'csv', 'excel', 'backup'],
    text: 'The Gantt screen exports the schedule as CSV or Excel. Settings has Export this project, which downloads a .pmai.json backup and can include the original documents. Reports download as Word, Excel, PowerPoint and Markdown from the Reports tab.' },
  { id: 'reports', title: 'Reports and documents', screen: 'reports', keys: ['report', 'reports', 'status report', 'generate document', 'template', 'word', 'powerpoint'],
    text: 'The Reports tab generates documents such as weekly status reports and steering committee summaries from the project data. The format is chosen first (Word, Excel or PowerPoint) and the download uses that format. Documents can be kept in folders and renamed.' },
  { id: 'baseline_versions', title: 'Baseline and schedule versions', screen: 'schedule', keys: ['baseline', 'version', 'versions', 'restore version', 'variance'],
    text: 'Setting a baseline on the Schedule tab saves the current start and finish of every task as the plan to compare against. Schedule versions keep a history of edits, can be compared, and an older version can be restored. Both are done on the Schedule screen.' },
  { id: 'updates_inbox', title: 'The Updates inbox', screen: 'inbox', keys: ['updates', 'inbox', 'suggestion', 'suggestions', 'jira update', 'outlook'],
    text: 'Updates holds suggestions made from Jira, Outlook and pasted messages, such as a progress change, a closed deliverable or a payment marked paid. Each suggestion shows its source and can be applied, dismissed or undone. Applied suggestions appear in the project history.' },
  { id: 'review', title: 'Review after document analysis', screen: 'review', keys: ['review', 'analysis', 'analyze', 'analyse', 'reanalyze', 'extracted', 'documents read'],
    text: 'When documents are uploaded they are read by the server. Items found in them, such as dates, deliverables, requirements, payment milestones and risks, wait on the Review tab. Each item shows its source quote. Confirm what is right and ignore what is not. Reanalyze runs a file again.' },
  { id: 'roles', title: 'Project roles', screen: 'settings', keys: ['role', 'roles', 'permission', 'permissions', 'viewer', 'editor', 'access', 'members'],
    text: 'Every project has members with one role. The project manager owns the project, manages access and is the only role that can delete it. An editor changes content such as tasks, documents and reports. A viewer can read everything and change nothing. Access is managed on the Settings tab.' },
  { id: 'schedule_index', title: 'Schedule index (SPI)', screen: 'overview', keys: ['schedule index', 'spi', 'schedule performance', 'planned', 'actual progress'],
    text: 'The schedule index compares the work done with the work planned by today. Planned progress comes from the baseline when there is one. A value of 1 means on plan. Below 1 means behind plan. Health turns amber below 0.95 and red below 0.8, and overdue tasks also move health.' },
  { id: 'health', title: 'Project health', screen: 'overview', keys: ['health', 'on track', 'at risk', 'off track', 'green', 'amber', 'red'],
    text: 'Health is On track, At risk or Off track. It comes from the schedule index and the number of overdue tasks. The overview and portfolio screens show it with the same rules.' },
  { id: 'critical_path', title: 'Critical path', screen: 'schedule', keys: ['critical path', 'critical', 'float', 'slack'],
    text: 'The critical path is the chain of tasks that sets the project end date. A delay on a critical task moves the project end. The Schedule tab highlights these tasks and the Overview lists the open ones.' },
  { id: 'payments', title: 'Payment milestones', screen: 'logs', keys: ['payment', 'payments', 'invoice', 'invoiced', 'paid', 'milestone payment', 'cash'],
    text: 'Payment milestones are items with an amount or a percent of the project value and a due date. Their state moves from pending to invoiced to paid. A pending payment past its due date counts as late. They are managed on the Logs tab and summarized on the Overview.' },
  { id: 'risks', title: 'Risks and the radar', screen: 'logs', keys: ['risk', 'risks', 'radar', 'probability', 'impact', 'mitigation'],
    text: 'Risks have a probability and an impact of Low, Medium or High, a mitigation and a state of open, mitigated, transferred or closed. They are managed on the Logs tab and shown on the risk radar of the overview and portfolio screens.' },
  { id: 'connections', title: 'Connect Jira and Outlook', screen: 'account', keys: ['jira', 'outlook', 'connect', 'connection', 'microsoft', 'atlassian'],
    text: 'Account settings has a Connect button for Jira and Outlook. It opens a step by step wizard: sign in, allow access, then a live check. Tokens are encrypted and never shown. The chat cannot connect or disconnect services. Do it from Account.' },
  { id: 'backup_restore', title: 'Backup and restore', screen: 'account', keys: ['restore', 'import project', 'workspace backup', 'backup and restore'],
    text: 'Account, Backup and restore exports every project you can edit. Projects, Import project reads either a project backup or a workspace backup. Imported projects get new ids and are added next to existing ones, never replacing them.' },
  { id: 'calendar', title: 'Calendar', screen: 'calendar', keys: ['calendar', 'due dates', 'markers'],
    text: 'The Calendar shows one marker per task or payment on its due date. A red ring means overdue. Clicking a marker opens details on the same screen.' },
  { id: 'language_theme', title: 'Language and theme', screen: 'account', keys: ['arabic', 'english', 'language', 'dark mode', 'theme', 'right to left'],
    text: 'The platform works in English and Arabic with a right to left layout. Dark mode and language can be switched from the side menu or Account settings. The choice is saved to the account.' },
  { id: 'widgets', title: 'Widget marketplace and builder', screen: 'widgets', keys: ['widget', 'widgets', 'marketplace', 'widget builder', 'build a widget', 'publish a widget', 'rate a widget', 'saved layout', 'layout', 'add widget', 'remove widget'],
    text: 'The Widgets screen is a marketplace for the two overview pages. Choose Portfolio overview or Project overview, search by name, group or author, filter by group, source and rating, then press Preview to see a widget drawn with your own project data before you add it. Add and Remove work in place and offer Undo. Use Build a widget to create your own from a form: pick the data (projects, tasks, payments, risks or deliverables), filters, and a number, bars, columns, line, area, combo, donut, radar, funnel or table. Save it as a draft, then Publish so every project manager can add and rate it. A published widget only reads the projects of the person who uses it. After you publish an update, people who already added the widget get the new version. Ratings are from 1 to 5 stars with an optional comment, and you can rate a widget after adding it to an overview. The Layouts button on each overview saves the widgets shown, their order and size under a name so you can apply it again later.' },
  { id: 'chat', title: 'What the Thinking Area can do', screen: 'thinking', keys: ['thinking', 'thinking area', 'chat', 'assistant', 'what can you do', 'help', 'capabilities', 'abilities', 'think deeper', 'threads'],
    text: 'The Thinking Area is where you think through your projects with AI. Open it from the round button at the bottom corner of any screen, or press Open as a full page, or use Thinking in the side menu or the Thinking tab of a project. It keeps your threads, which you can search, rename and pin. Think deeper gives the AI more time to reason about schedules and trade offs and uses more of your tokens. It answers questions about your projects, tasks, risks, deliverables, requirements, payments, updates and documents, and shows where each answer came from. It can propose new or changed tasks, risks, deliverables, requirements and payment states, and nothing is saved until you press Apply. Every applied change can be undone. It does not write code or unrelated content, and it does not manage accounts, billing or access.' },
];

const score = (topic, q) => {
  const text = String(q || '').toLowerCase();
  let s = 0;
  for (const k of topic.keys) if (text.includes(k)) s += k.split(' ').length + 1;
  for (const w of text.match(/[a-z؀-ۿ]{4,}/g) || []) if (topic.title.toLowerCase().includes(w)) s += 1;
  return s;
};
function lookup(query) {
  const all = TOPICS.map((t) => ({ t, s: score(t, query) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  // a second topic is only kept when it is nearly as good a match, so sources stay relevant
  const ranked = all.filter((x, i) => i === 0 || (i === 1 && x.s >= all[0].s * 0.7));
  return ranked.map((x) => ({ id: x.t.id, title: x.t.title, text: x.t.text, screen: x.t.screen }));
}

module.exports = { TOPICS, lookup };
