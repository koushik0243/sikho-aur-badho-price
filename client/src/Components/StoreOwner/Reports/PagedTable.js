'use client';

import { useState } from 'react';
import apiServiceHandler from '../../../service/apiService';
import { ReportTable, Pagination } from '../../SuperAdmin/Reports/ReportParts';

// Store owner report tables are paged on the server: a page view downloads one page of
// each table (plus the summary numbers, which cover every row). See
// server/reports/org_report_paging.js for the query params.

export const PAGE_SIZE = 20;

/**
 * Which page each table of a report is on, as query params for useReport:
 * { limit, <table>Page } — `limit` asks the server for paged tables.
 * A filter change calls resetPages() so every table starts again at page 1.
 */
export function useTablePages() {
  const [pages, setPages] = useState({});
  const pageParams = { limit: PAGE_SIZE };
  Object.entries(pages).forEach(([key, page]) => { pageParams[`${key}Page`] = page; });
  const setPage = (key, page) => setPages(prev => ({ ...prev, [key]: page }));
  const resetPages = () => setPages({});
  return { pageParams, setPage, resetPages };
}

/**
 * A report table showing one server page: `list` is { rows, total, page, limit, pages }.
 * Other props as ReportTable (no pageSize: the rows are already one page).
 */
export function PagedTable({ list, onPage, footer, ...table }) {
  const pager = (
    <Pagination page={list.page} pageCount={list.pages} total={list.total} pageSize={list.limit}
      onPage={p => onPage(Math.min(Math.max(1, p), list.pages))} label={table.title} />
  );
  return <ReportTable {...table} rows={list.rows} footer={<>{pager}{footer}</>} />;
}

/**
 * The whole report (every row of every table), for the PDF export — fetched only when
 * the owner clicks Export, so a normal page view never downloads it.
 * @param {string} endpoint  e.g. 'progress'
 * @param {object} params    the page's filters (empty values are left out)
 */
export async function fetchFullReport(endpoint, params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  qs.set('t', String(Date.now())); // always fresh, like the page itself
  const res = await apiServiceHandler('GET', `org-report/${endpoint}?${qs}`);
  if (!res?.data) throw new Error('The report could not be loaded.');
  return res.data;
}
