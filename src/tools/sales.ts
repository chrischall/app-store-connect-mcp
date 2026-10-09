import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { gunzipSync } from 'zlib';
import { minifiedResult } from '@chrischall/mcp-utils';
import { client } from '../client.js';
import { ToolResult } from '../types.js';

interface ParsedReport {
  rows: Array<Record<string, string>>;
  /** Trailer lines such as `Total_Rows` / `Total_Amount` / `Total_Units`, keyed by first cell. */
  summary: Record<string, string>;
}

/**
 * Convert a gzipped TSV report buffer to row objects plus any summary lines.
 * App Store Connect sales/finance reports always come back gzipped. Finance
 * reports end with `Total_*` trailer lines (and detail reports can repeat the
 * header per section); those are not data rows, so a line whose first cell is
 * `Total_*` goes to `summary` and a repeated header line is skipped. A label
 * seen again gets a ` (2)`, ` (3)`... suffix rather than overwriting the
 * earlier value. Every other line is a data row whatever its cell count:
 * missing cells become '' and cells beyond the header are kept, tab-joined,
 * under `_extra`, so nothing is dropped.
 */
function parseGzippedTsv(buffer: Buffer): ParsedReport {
  const text = gunzipSync(buffer).toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const summary: Record<string, string> = {};
  if (lines.length === 0) return { rows: [], summary };
  const headerLine = lines[0]!;
  const headers = headerLine.split('\t');
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    if (line === headerLine) continue;
    const cells = line.split('\t');
    if (/^Total_/.test(cells[0]!)) {
      let key = cells[0]!;
      for (let n = 2; key in summary; n++) key = `${cells[0]} (${n})`;
      summary[key] = cells.slice(1).join('\t');
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    if (cells.length > headers.length) row._extra = cells.slice(headers.length).join('\t');
    rows.push(row);
  }
  return { rows, summary };
}

export async function downloadSalesReport(args: {
  vendorNumber: string;
  reportDate: string;
  frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  reportType?: 'SALES' | 'PRE_ORDER' | 'NEWSSTAND' | 'SUBSCRIPTION' | 'SUBSCRIPTION_EVENT' | 'SUBSCRIPTION_OFFER_CODE_REDEMPTION' | 'SUBSCRIBER';
  reportSubType?: 'SUMMARY' | 'DETAILED';
  version?: string;
  limit?: number;
}): Promise<ToolResult> {
  const { buffer } = await client.requestRaw('GET', '/v1/salesReports', {
    'filter[vendorNumber]': args.vendorNumber,
    'filter[reportDate]': args.reportDate,
    'filter[frequency]': args.frequency ?? 'DAILY',
    'filter[reportType]': args.reportType ?? 'SALES',
    'filter[reportSubType]': args.reportSubType ?? 'SUMMARY',
    'filter[version]': args.version ?? '1_0',
  });
  const { rows, summary } = parseGzippedTsv(buffer);
  const limit = args.limit ?? 500;
  const truncated = rows.length > limit;
  const preview = truncated ? rows.slice(0, limit) : rows;
  return minifiedResult({
    reportDate: args.reportDate,
    frequency: args.frequency ?? 'DAILY',
    reportType: args.reportType ?? 'SALES',
    totalRows: rows.length,
    returnedRows: preview.length,
    truncated,
    rows: preview,
    ...(Object.keys(summary).length > 0 ? { summary } : {}),
  });
}

export async function downloadFinanceReport(args: {
  vendorNumber: string;
  reportDate: string;
  regionCode: string;
  reportType?: 'FINANCIAL' | 'FINANCE_DETAIL';
  limit?: number;
}): Promise<ToolResult> {
  const { buffer } = await client.requestRaw('GET', '/v1/financeReports', {
    'filter[vendorNumber]': args.vendorNumber,
    'filter[reportDate]': args.reportDate,
    'filter[regionCode]': args.regionCode,
    'filter[reportType]': args.reportType ?? 'FINANCIAL',
  });
  const { rows, summary } = parseGzippedTsv(buffer);
  const limit = args.limit ?? 500;
  const truncated = rows.length > limit;
  const preview = truncated ? rows.slice(0, limit) : rows;
  return minifiedResult({
    reportDate: args.reportDate,
    regionCode: args.regionCode,
    reportType: args.reportType ?? 'FINANCIAL',
    totalRows: rows.length,
    returnedRows: preview.length,
    truncated,
    rows: preview,
    ...(Object.keys(summary).length > 0 ? { summary } : {}),
  });
}

export function registerSalesTools(server: McpServer): void {
  server.registerTool(
    'download_sales_report',
    {
      description:
        'Download a sales/units report. Returns parsed TSV rows. Use a vendor number from App Store Connect > Payments and Financial Reports.',
      inputSchema: z.object({
        vendorNumber: z.string().describe('Apple-issued vendor number (e.g. "80012345")'),
        reportDate: z.string().describe('Report date — DAILY: YYYY-MM-DD, WEEKLY: YYYY-MM-DD (Sunday), MONTHLY: YYYY-MM, YEARLY: YYYY'),
        frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional().describe('Report frequency (default DAILY)'),
        reportType: z
          .enum(['SALES', 'PRE_ORDER', 'NEWSSTAND', 'SUBSCRIPTION', 'SUBSCRIPTION_EVENT', 'SUBSCRIPTION_OFFER_CODE_REDEMPTION', 'SUBSCRIBER'])
          .optional()
          .describe('Report type (default SALES)'),
        reportSubType: z.enum(['SUMMARY', 'DETAILED']).optional().describe('Report sub-type (default SUMMARY)'),
        version: z.string().optional().describe('Report version (default 1_0). Newer SALES reports use 1_1 with extra columns.'),
        limit: z.number().int().min(1).max(10000).optional().describe('Max rows to return inline (default 500). Total row count is always reported.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    downloadSalesReport
  );

  server.registerTool(
    'download_finance_report',
    {
      description:
        'Download a financial report (proceeds and adjustments) for a region. Returns parsed TSV rows; the Total_* trailer lines (Total_Rows, Total_Amount, Total_Units) come back in a separate summary object, not in rows.',
      inputSchema: z.object({
        vendorNumber: z.string().describe('Apple-issued vendor number'),
        reportDate: z.string().describe('Fiscal report month, format YYYY-MM (e.g. "2025-09")'),
        regionCode: z.string().describe('Region code, e.g. "Z1" (worldwide), "US", "EU", "JP"'),
        reportType: z.enum(['FINANCIAL', 'FINANCE_DETAIL']).optional().describe('Report type (default FINANCIAL)'),
        limit: z.number().int().min(1).max(10000).optional().describe('Max rows to return inline (default 500)'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    downloadFinanceReport
  );
}
