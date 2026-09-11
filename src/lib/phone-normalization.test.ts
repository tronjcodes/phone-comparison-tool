import { describe, expect, it } from 'vitest';
import phoneNormalization from '@/lib/phone-normalization.js';

const {
  slugify,
  normalizeKey,
  normalizePhoneRecord,
  parseNumericArrayBlob,
} = phoneNormalization as {
  slugify: (value: string) => string;
  normalizeKey: (value: string) => string;
  normalizePhoneRecord: (raw: unknown) => Record<string, unknown> | null;
  parseNumericArrayBlob: (value: string | null) => number[];
};

// The parse* helpers below (parseRamOptions, parseStorageOptions, parseRefreshRate,
// parseDateValue, parseChipset, parseChipsetNodeNm) are not exported directly - they're
// only reachable through normalizePhoneRecord's `sections` pipeline. Drive them through
// a raw phone fixture instead of importing them individually.
const rawPhone = (specs: Record<string, Record<string, string>>, overrides: Record<string, unknown> = {}) => ({
  brand: 'TestBrand',
  model: 'TestModel X',
  specs,
  ...overrides,
});

describe('slugify', () => {
  it('converts plus signs to "plus"', () => {
    expect(slugify('Galaxy S23+')).toBe('galaxy-s23-plus');
  });

  it('collapses non-alphanumeric runs into single dashes', () => {
    expect(slugify('Redmi Note 12 (Global)')).toBe('redmi-note-12-global');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --Pixel 8--  ')).toBe('pixel-8');
  });
});

describe('normalizeKey', () => {
  it('produces underscore-separated keys', () => {
    expect(normalizeKey('Main Camera')).toBe('main_camera');
  });

  it('trims leading and trailing underscores', () => {
    expect(normalizeKey('--RAM--')).toBe('ram');
  });
});

describe('RAM and storage parsing (via normalizePhoneRecord)', () => {
  it('extracts RAM from a dedicated RAM field', () => {
    const phone = rawPhone({ memory: { ram: '8GB, 12GB' } });
    const result = normalizePhoneRecord(phone) as { performanceRamOptions: string };
    expect(JSON.parse(result.performanceRamOptions)).toEqual([8, 12]);
  });

  it('does not let bare storage GB values leak into RAM when read from a combined field', () => {
    const phone = rawPhone({ memory: { internal: '256GB storage, 8GB RAM' } });
    const result = normalizePhoneRecord(phone) as { performanceRamOptions: string };
    expect(JSON.parse(result.performanceRamOptions)).toEqual([8]);
  });

  it('extracts storage without cross-contamination from RAM (regression for f6a7233)', () => {
    const phone = rawPhone({ memory: { internal: '256GB storage, 8GB RAM' } });
    const result = normalizePhoneRecord(phone) as { storageOptions: string };
    expect(JSON.parse(result.storageOptions)).toEqual([256]);
  });

  it('excludes a RAM value from storage even when it clears the >=32 plausibility filter', () => {
    // Uses an unrealistically large RAM figure specifically so the >=32 storage
    // filter can't mask a regression in the "(?!\s*RAM)" negative lookahead itself.
    const phone = rawPhone({ memory: { internal: '256GB storage, 32GB RAM' } });
    const result = normalizePhoneRecord(phone) as { storageOptions: string };
    expect(JSON.parse(result.storageOptions)).toEqual([256]);
  });

  it('parses combined RAM+storage rows into disjoint, correct sets', () => {
    const phone = rawPhone({ memory: { internal: '128GB 6GB RAM, 256GB 8GB RAM' } });
    const result = normalizePhoneRecord(phone) as { performanceRamOptions: string; storageOptions: string };
    expect(JSON.parse(result.performanceRamOptions)).toEqual([6, 8]);
    expect(JSON.parse(result.storageOptions)).toEqual([128, 256]);
  });

  it('converts TB storage values to GB and drops implausibly small values', () => {
    const phone = rawPhone({ memory: { storage: '1TB, 16GB, 128GB' } });
    const result = normalizePhoneRecord(phone) as { storageOptions: string };
    expect(JSON.parse(result.storageOptions)).toEqual([128, 1024]);
  });
});

describe('refresh rate parsing (via normalizePhoneRecord)', () => {
  it('picks the maximum plausible refresh rate', () => {
    const phone = rawPhone({ display: { refresh_rate: '60Hz, 120Hz' } });
    const result = normalizePhoneRecord(phone) as { displayRefreshRate: number };
    expect(result.displayRefreshRate).toBe(120);
  });

  it('falls back to the first match when nothing is in the plausible 50-240Hz range', () => {
    const phone = rawPhone({ display: { type: '10Hz something unusual' } });
    const result = normalizePhoneRecord(phone) as { displayRefreshRate: number };
    expect(result.displayRefreshRate).toBe(10);
  });

  it('defaults to 60 when no refresh rate is present', () => {
    const phone = rawPhone({ display: { size: '6.1 inches' } });
    const result = normalizePhoneRecord(phone) as { displayRefreshRate: number };
    expect(result.displayRefreshRate).toBe(60);
  });
});

describe('release date parsing (via normalizePhoneRecord)', () => {
  it('parses a full "YYYY, Month D" date', () => {
    const phone = rawPhone({ software: { announced: '2023, February 17' } });
    const result = normalizePhoneRecord(phone) as { releaseDate: string };
    expect(result.releaseDate).toBe(new Date('February 17, 2023').toISOString());
  });

  it('strips "Available. Released" / "Status:" prefixes before parsing', () => {
    const phone = rawPhone({ software: { status: 'Available. Released 2022, September 16' } });
    const result = normalizePhoneRecord(phone) as { releaseDate: string };
    expect(result.releaseDate).toBe(new Date('September 16, 2022').toISOString());
  });

  it('falls back to a year-month date when no day is present', () => {
    const phone = rawPhone({ software: { announced: '2021, August' } });
    const result = normalizePhoneRecord(phone) as { releaseDate: string };
    expect(result.releaseDate).toBe(new Date('August 1, 2021').toISOString());
  });

  it('falls back to a bare year when nothing more specific is present', () => {
    const phone = rawPhone({ software: { announced: 'Exp. release 2020' } });
    const result = normalizePhoneRecord(phone) as { releaseDate: string };
    expect(result.releaseDate).toBe(new Date('2020-01-01T00:00:00Z').toISOString());
  });

  it('returns null when no date can be parsed', () => {
    const phone = rawPhone({ software: { announced: 'Coming soon' } });
    const result = normalizePhoneRecord(phone) as { releaseDate: string | null };
    expect(result.releaseDate).toBeNull();
  });
});

describe('chipset parsing (via normalizePhoneRecord)', () => {
  it('strips the nm parenthetical from the chipset name', () => {
    const phone = rawPhone({ performance: { chipset: 'Snapdragon 8 Gen 2 (4 nm)' } });
    const result = normalizePhoneRecord(phone) as { performanceChipset: string };
    expect(result.performanceChipset).toBe('Snapdragon 8 Gen 2');
  });

  it('extracts the node size in nm separately', () => {
    const phone = rawPhone({ performance: { chipset: 'Snapdragon 8 Gen 2 (4 nm)' } });
    const result = normalizePhoneRecord(phone) as { performanceChipsetNodeNm: number };
    expect(result.performanceChipsetNodeNm).toBe(4);
  });
});

describe('normalizePhoneRecord', () => {
  it('returns null when brand or model is missing', () => {
    expect(normalizePhoneRecord({ model: 'X' })).toBeNull();
    expect(normalizePhoneRecord({ brand: 'X' })).toBeNull();
    expect(normalizePhoneRecord(null)).toBeNull();
  });

  it('derives slugs and JSON fields from the "specs" object shape', () => {
    const phone = rawPhone({
      memory: { ram: '8GB', internal: '256GB' },
    });
    const result = normalizePhoneRecord(phone) as Record<string, unknown>;
    expect(result.brandSlug).toBe('testbrand');
    expect(result.deviceSlug).toBe('testmodel-x');
    expect(JSON.parse(result.performanceRamOptions as string)).toEqual([8]);
    expect(JSON.parse(result.storageOptions as string)).toEqual([256]);
  });

  it('derives the same fields from the "specifications" array shape', () => {
    const phone = {
      brand: 'TestBrand',
      model: 'TestModel X',
      specifications: [
        {
          title: 'Memory',
          specs: [
            { key: 'RAM', value: '8GB' },
            { key: 'Internal', value: '256GB' },
          ],
        },
      ],
    };
    const result = normalizePhoneRecord(phone) as Record<string, unknown>;
    expect(JSON.parse(result.performanceRamOptions as string)).toEqual([8]);
    expect(JSON.parse(result.storageOptions as string)).toEqual([256]);
  });
});

describe('parseNumericArrayBlob', () => {
  it('parses a valid JSON array of numbers', () => {
    expect(parseNumericArrayBlob('[8, 12, 16]')).toEqual([8, 12, 16]);
  });

  it('returns an empty array for non-array JSON', () => {
    expect(parseNumericArrayBlob('{"a": 1}')).toEqual([]);
  });

  it('returns an empty array for invalid JSON', () => {
    expect(parseNumericArrayBlob('not json')).toEqual([]);
  });

  it('returns an empty array for null or empty input', () => {
    expect(parseNumericArrayBlob(null)).toEqual([]);
    expect(parseNumericArrayBlob('')).toEqual([]);
  });

  it('filters out non-numeric entries', () => {
    expect(parseNumericArrayBlob('[8, "12", null, 16]')).toEqual([8, 16]);
  });
});
