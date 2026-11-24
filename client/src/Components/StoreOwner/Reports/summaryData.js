// Shared by the Summary page and its PDF export.

export const DONE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' },
  { value: 'not', label: 'Not done' },
];
// The server applies these filters (DONE_FILTERS in server/reports/org_report_paging.js).

export const RULES_TEXT = [
  'Store completion = enrolled courses completed ÷ all enrolled courses (one course assigned to one employee = one enrolled course).',
  'Performance = the average of an employee\'s course progress and their average best quiz score (progress only, if they have not taken a quiz). Best performers = the top 3 with some progress; weak performers = the 3 lowest of the rest.',
  'Zoom attended = the employee opened the session with the Join button in the course player. Homework done = marked done in the course player (there is no file upload). Both are recorded from when tracking started.',
];
