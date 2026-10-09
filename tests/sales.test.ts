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

  it('downloadFinanceReport: keeps trailing Total_* summary lines out of the data rows', async () => {
    const tsv = [
      'Start Date\tEnd Date\tUnits\tPartner Share',
      '09/01/2025\t09/30/2025\t3\t2.10',
      '09/01/2025\t09/30/2025\t1\t0.70',
      '',
      'Total_Rows\t2',
      'Total_Amount\t2.80',
      'Total_Units\t4',
    ].join('\n');
    rawSpy.mockResolvedValueOnce({ buffer: gzipSync(Buffer.from(tsv, 'utf8')), contentType: 'application/a-gzip' });

    const result = await downloadFinanceReport({ vendorNumber: '8001', reportDate: '2025-09', regionCode: 'US' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.every((r: Record<string, string>) => r['Start Date'] === '09/01/2025')).toBe(true);
    expect(parsed.summary).toEqual({ Total_Rows: '2', Total_Amount: '2.80', Total_Units: '4' });
  });

  it('downloadSalesReport: keeps a data row with a different cell count as a row, not summary', async () => {
    const tsv = [
      'Provider\tTitle\tUnits',
      'APPLE\tShort', // trailing empty cell trimmed by the producer
      'APPLE\tMy App\t7',
      'APPLE\tLong\t3\textra1\textra2',
    ].join('\n');
    rawSpy.mockResolvedValueOnce({ buffer: gzipSync(Buffer.from(tsv, 'utf8')), contentType: 'application/a-gzip' });
    const result = await downloadSalesReport({ vendorNumber: '8001', reportDate: '2025-09-15' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalRows).toBe(3);
    expect(parsed.rows[0]).toEqual({ Provider: 'APPLE', Title: 'Short', Units: '' });
    expect(parsed.rows[2]).toEqual({ Provider: 'APPLE', Title: 'Long', Units: '3', _extra: 'extra1\textra2' });
    expect(parsed).not.toHaveProperty('summary');
  });

  it('downloadFinanceReport: a repeated Total_* label does not overwrite the earlier one', async () => {
    const tsv = [
      'Region\tAmount',
      'US\t1.00',
      'Total_Amount\t1.00',
      'Region\tAmount',
      'EU\t2.00',
      'Total_Amount\t2.00',
    ].join('\n');
    rawSpy.mockResolvedValueOnce({ buffer: gzipSync(Buffer.from(tsv, 'utf8')), contentType: 'application/a-gzip' });
    const result = await downloadFinanceReport({ vendorNumber: '8001', reportDate: '2025-09', regionCode: 'Z1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.summary).toEqual({ Total_Amount: '1.00', 'Total_Amount (2)': '2.00' });
  });

  it('downloadSalesReport: omits summary when the report has none', async () => {
    rawSpy.mockResolvedValueOnce({ buffer: makeGzippedTsv([['A', 'B'], ['1', '2']]), contentType: 'application/a-gzip' });
    const result = await downloadSalesReport({ vendorNumber: '8001', reportDate: '2025-09-15' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalRows).toBe(1);
    expect(parsed).not.toHaveProperty('summary');
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
