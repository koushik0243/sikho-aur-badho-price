// Server-side paging for the store owner report tables.
//
// A report is built once (and cached) with every row; a page view then gets only one
// page of each table, while the summary numbers stay computed over every row. Without
// paging params the full report is returned (the PDF export and the learner's own
// report rely on that shape).
//
// Query params (all optional):
//   limit=20              rows per page (1–100); its presence turns paging on
//   page=1                default page of every table
//   <table>Page=2         page of one table, e.g. enrollmentsPage=2 (overrides `page`)
//   <table>Filter=done    chip filter of a table that has one, e.g. zoomRowsFilter=not
//   all=1                 the full report even when paging params are present
// A paged table comes back as { rows, total, page, limit, pages } (+ filter, counts).

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const POSITIVE_INT = /^[1-9]\d{0,5}$/;

/** An error the controller answers with 400. */
const badParam = (message) => Object.assign(new Error(message), { status: 400 });

const intParam = (value, name) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !POSITIVE_INT.test(value)) throw badParam(`${name} must be a whole number of 1 or more.`);
  return Number(value);
};

const filterParam = (value, section) => {
  if (value === undefined || value === '') return 'all';
  if (typeof value !== 'string' || !Object.hasOwn(section.filters, value)) throw badParam(`Unknown ${section.key} filter.`);
  return value;
};

/**
 * Reads the paging params of one report.
 * @param {object} query  req.query
 * @param {Array<{ key: string, filters?: object }>} sections  the report's paged tables
 * @returns {null | { limit: number, pageOf: (key: string) => number, filterOf: (key: string) => string }}
 *   null = no paging (return the full report)
 * @throws an error with status 400 when a param is invalid
 */
export function readPaging(query, sections) {
  if (query.all === '1' || query.all === 'true') return null;
  const wantsPaging = query.limit !== undefined || query.page !== undefined
    || sections.some(sec => query[`${sec.key}Page`] !== undefined);
  if (!wantsPaging) return null;

  const limit = intParam(query.limit, 'limit') ?? DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) throw badParam(`limit can be at most ${MAX_LIMIT}.`);
  const defaultPage = intParam(query.page, 'page') ?? 1;
  const pages = new Map(sections.map(sec => [sec.key, intParam(query[`${sec.key}Page`], `${sec.key}Page`) ?? defaultPage]));
  const filters = new Map(sections.filter(sec => sec.filters).map(sec => [sec.key, filterParam(query[`${sec.key}Filter`], sec)]));
  return { limit, pageOf: key => pages.get(key), filterOf: key => filters.get(key) || 'all' };
}

/** One page of `rows`; a page past the end shows the last page (data can shrink between clicks). */
export function pageOf(rows, page, limit) {
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const current = Math.min(page, pages);
  const start = (current - 1) * limit;
  return { rows: rows.slice(start, start + limit), total: rows.length, page: current, limit, pages };
}

/**
 * Pages one table: the chip filter (when the table has one), then the page.
 * `counts` = rows per chip over the whole table, so the chips show the right numbers.
 */
function pageSection(rows, section, paging) {
  if (!section.filters) return pageOf(rows, paging.pageOf(section.key), paging.limit);
  const filter = paging.filterOf(section.key);
  const counts = Object.fromEntries(Object.entries(section.filters).map(([name, keep]) => [name, rows.filter(keep).length]));
  return { ...pageOf(rows.filter(section.filters[filter]), paging.pageOf(section.key), paging.limit), filter, counts };
}

/**
 * A copy of `report` with each section's array replaced by one page of it.
 * The cached report is never changed (later requests share it).
 * @param {object} report  the full report
 * @param {Array<{ key: string, filters?: Record<string, (row: object) => boolean>, mapRow?: (row: object) => object }>} sections
 *   mapRow trims a row for the page view (e.g. a long list of names)
 * @param {ReturnType<typeof readPaging>} paging
 */
export function pageSections(report, sections, paging) {
  if (!paging) return report;
  const paged = { ...report, paged: true };
  for (const section of sections) {
    const page = pageSection(report[section.key] || [], section, paging);
    paged[section.key] = section.mapRow ? { ...page, rows: page.rows.map(section.mapRow) } : page;
  }
  return paged;
}

/** Chip filters of the tables of done / not done rows. */
export const DONE_FILTERS = { all: () => true, done: r => r.done, not: r => !r.done };
