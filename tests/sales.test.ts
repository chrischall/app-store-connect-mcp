import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gzipSync } from 'zlib';
import { client } from '../src/client.js';
import { downloadSalesReport, downloadFinanceReport } from '../src/tools/sales.js';

function makeGzippedTsv(rows: string[][]): Buffer {
  const tsv = rows.map((r) => r.join('\t')).join('\n');
  return gzipSync(Buffer.from(tsv, 'utf8'));
}

describe('sales tools', () => {
  let rawSpy: ReturnType<typeof vi.spyOn<typeof client, 'requestRaw'>>;

  beforeEach(() => {
    rawSpy = vi.spyOn(client, 'requestRaw');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloadSalesReport: passes default filters and parses gzipped TSV', async () => {
    const buf = makeGzippedTsv([
      ['Provider', 'Title', 'Units'],
      ['APPLE', 'My App', '42'],
      ['APPLE', 'My App', '7'],
    ]);
    rawSpy.mockResolvedValueOnce({ buffer: buf, contentType: 'application/a-gzip' });

    const result = await downloadSalesReport({ vendorNumber: '8001', reportDate: '2025-09-15' });
    expect(rawSpy).toHaveBeenCalledWith('GET', '/v1/salesReports', {
      'filter[vendorNumber]': '8001',
      'filter[reportDate]': '2025-09-15',
      'filter[frequency]': 'DAILY',
      'filter[reportType]': 'SALES',
      'filter[reportSubType]': 'SUMMARY',
      'filter[version]': '1_0',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.rows[0]).toEqual({ Provider: 'APPLE', Title: 'My App', Units: '42' });
    expect(parsed.truncated).toBe(false);
  });

  it('downloadSalesReport: marks truncated=true and limits returned rows', async () => {
    const rows: string[][] = [['ID']];
    for (let i = 0; i < 10; i++) rows.push([String(i)]);
    rawSpy.mockResolvedValueOnce({ buffer: makeGzippedTsv(rows), contentType: 'application/a-gzip' });

    const result = await downloadSalesReport({ vendorNumber: '8001', reportDate: '2025-09-15', limit: 3 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalRows).toBe(10);
    expect(parsed.returnedRows).toBe(3);
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows).toHaveLength(3);
  });

  it('downloadSalesReport: passes through frequency / reportType / version overrides', async () => {
    const buf = makeGzippedTsv([['x'], ['y']]);
    rawSpy.mockResolvedValueOnce({ buffer: buf, contentType: 'application/a-gzip' });

    await downloadSalesReport({
      vendorNumber: '8001',
      reportDate: '2025-09',
      frequency: 'MONTHLY',
      reportType: 'SUBSCRIPTION',
      reportSubType: 'DETAILED',
      version: '1_3',
    });
    expect(rawSpy).toHaveBeenCalledWith('GET', '/v1/salesReports', {
      'filter[vendorNumber]': '8001',
      'filter[reportDate]': '2025-09',
      'filter[frequency]': 'MONTHLY',
      'filter[reportType]': 'SUBSCRIPTION',
      'filter[reportSubType]': 'DETAILED',
      'filter[version]': '1_3',
    });
  });

  it('downloadFinanceReport: builds correct query', async () => {
    const buf = makeGzippedTsv([['a', 'b'], ['1', '2']]);
    rawSpy.mockResolvedValueOnce({ buffer: buf, contentType: 'application/a-gzip' });

    await downloadFinanceReport({ vendorNumber: '8001', reportDate: '2025-09', regionCode: 'US' });
    expect(rawSpy).toHaveBeenCalledWith('GET', '/v1/financeReports', {
      'filter[vendorNumber]': '8001',
      'filter[reportDate]': '2025-09',
      'filter[regionCode]': 'US',
      'filter[reportType]': 'FINANCIAL',
    });
  });
});
