import { describe, expect, it } from 'vitest';
import { buildXlsx, columnName, crc32 } from './xlsx';

describe('xlsx', () => {
  it('ustun nomlari', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });

  it('CRC32 ma’lum qiymat bilan mos', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('ZIP tuzilmasi: fayllar va markaziy katalog, matn XML’da xavfsiz', () => {
    const bytes = buildXlsx([
      {
        name: 'To‘lovlar',
        rows: [
          ['Sayt', 'Summa'],
          ['A & <B>', 500000.5],
        ],
      },
    ]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(6);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('A &amp; &lt;B&gt;');
    expect(text).toContain('<v>500000.5</v>');
    expect(text).toContain('name="To‘lovlar"');
  });
});
