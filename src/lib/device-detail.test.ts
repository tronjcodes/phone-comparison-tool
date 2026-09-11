import { describe, expect, it } from 'vitest';
import { buildDeviceDetail, type DeviceWithBrand } from '@/lib/device-detail';

const makeDevice = (
  specs: Record<string, Record<string, string>>,
  overrides: Partial<DeviceWithBrand> = {}
): DeviceWithBrand =>
  ({
    name: 'TestBrand TestModel',
    model: 'TestModel',
    imageUrl: null,
    specBlob: JSON.stringify(specs),
    performanceRamOptions: '[]',
    storageOptions: '[]',
    displaySizeInches: null,
    displayResolution: null,
    displayRefreshRate: null,
    displayType: null,
    performanceChipset: null,
    performanceChipsetNodeNm: null,
    cameraMainMp: null,
    cameraFrontMp: null,
    batteryCapacityMah: null,
    batteryWiredChargingW: null,
    weightG: null,
    releaseDate: null,
    isDiscontinued: false,
    brand: { name: 'TestBrand' },
    ...overrides,
  }) as unknown as DeviceWithBrand;

describe('buildDeviceDetail - formatStorageCapacity (via structured storageOptions)', () => {
  it('formats a value >= 1024 that divides evenly as TB', () => {
    const device = makeDevice({}, { storageOptions: '[1024, 2048]' });
    const detail = buildDeviceDetail(device);
    expect(detail.quickSpec.find((s) => s.name === 'Storage')?.value).toBe('1TB, 2TB');
  });

  it('formats a value under 1024 as GB', () => {
    const device = makeDevice({}, { storageOptions: '[256]' });
    const detail = buildDeviceDetail(device);
    expect(detail.quickSpec.find((s) => s.name === 'Storage')?.value).toBe('256GB');
  });

  it('formats a >= 1024 value that does not divide evenly as GB', () => {
    const device = makeDevice({}, { storageOptions: '[1536]' });
    const detail = buildDeviceDetail(device);
    expect(detail.quickSpec.find((s) => s.name === 'Storage')?.value).toBe('1536GB');
  });
});

describe('buildDeviceDetail - RAM fallback extraction (regression for f6a7233)', () => {
  it('extracts only "<n>GB RAM" from a combined internal spec string, ignoring storage GB', () => {
    const device = makeDevice({
      performance: { internal: '256GB storage, 8GB RAM' },
    });
    const detail = buildDeviceDetail(device);
    expect(detail.quickSpec.find((s) => s.name === 'RAM')?.value).toBe('8GB RAM');
  });

  it('falls back to N/A when no RAM value is present', () => {
    const device = makeDevice({
      performance: { internal: '256GB storage only' },
    });
    const detail = buildDeviceDetail(device);
    expect(detail.quickSpec.find((s) => s.name === 'RAM')?.value).toBe('N/A');
  });

  it('prefers structured performanceRamOptions over the regex fallback when present', () => {
    const device = makeDevice(
      { performance: { internal: '256GB storage, 8GB RAM' } },
      { performanceRamOptions: '[6, 8]' }
    );
    const detail = buildDeviceDetail(device);
    expect(detail.quickSpec.find((s) => s.name === 'RAM')?.value).toBe('6GB RAM, 8GB RAM');
  });
});

describe('buildDeviceDetail - storage fallback extraction', () => {
  it('excludes "<n>GB RAM" from the storage fallback via the negative lookahead', () => {
    const device = makeDevice({
      performance: { internal: '256GB storage, 8GB RAM' },
    });
    const detail = buildDeviceDetail(device);
    expect(detail.quickSpec.find((s) => s.name === 'Storage')?.value).toBe('256GB');
  });
});

describe('buildDeviceDetail - wireless charging extraction', () => {
  it('extracts a "<n>W wireless" substring', () => {
    const device = makeDevice({
      battery: { charging: '65W wired, 15W wireless, reverse wireless' },
    });
    const detail = buildDeviceDetail(device);
    const wireless = detail.detailSpec
      .find((c) => c.category === 'Battery & Charging')
      ?.specifications.find((s) => s.name === 'Wireless Charging');
    expect(wireless?.value).toBe('15W wireless');
  });

  it('returns N/A when there is no wireless mention', () => {
    const device = makeDevice({
      battery: { charging: '65W wired' },
    });
    const detail = buildDeviceDetail(device);
    const wireless = detail.detailSpec
      .find((c) => c.category === 'Battery & Charging')
      ?.specifications.find((s) => s.name === 'Wireless Charging');
    expect(wireless?.value).toBe('N/A');
  });
});

describe('buildDeviceDetail - refresh rate extraction', () => {
  it('extracts "<n>Hz" from the display type string', () => {
    const device = makeDevice({
      display: { type: 'AMOLED, 120Hz, HDR10+' },
    });
    const detail = buildDeviceDetail(device);
    const refreshRate = detail.detailSpec
      .find((c) => c.category === 'Display')
      ?.specifications.find((s) => s.name === 'Refresh Rate');
    expect(refreshRate?.value).toBe('120Hz');
  });

  it('returns N/A when there is no display type value', () => {
    const device = makeDevice({});
    const detail = buildDeviceDetail(device);
    const refreshRate = detail.detailSpec
      .find((c) => c.category === 'Display')
      ?.specifications.find((s) => s.name === 'Refresh Rate');
    expect(refreshRate?.value).toBe('N/A');
  });
});
