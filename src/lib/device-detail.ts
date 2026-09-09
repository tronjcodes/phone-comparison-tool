import type { Brand, Device } from '@prisma/client';
import { getSpecsForDevice } from '@/lib/phone-catalog';
import phoneNormalization from '@/lib/phone-normalization.js';

const { parseNumericArrayBlob } = phoneNormalization as {
  parseNumericArrayBlob: (value: string | null) => number[];
};

export type DeviceWithBrand = Device & { brand: Brand };

export type QuickSpec = { name: string; value: string };
export type DetailSpecCategory = {
  category: string;
  specifications: QuickSpec[];
};

export type DeviceDetail = {
  name: string;
  brand: string;
  model: string;
  img: string;
  rawSpecs: Record<string, Record<string, string>>;
  quickSpec: QuickSpec[];
  detailSpec: DetailSpecCategory[];
};

const formatNumber = (value: number | null | undefined, suffix?: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return `${value}${suffix || ''}`;
};

const formatOptions = (values: number[], suffix: string) => {
  if (values.length === 0) {
    return null;
  }

  return values.map((value) => `${value}${suffix}`).join(', ');
};

const formatDate = (value: Date | null | undefined) => {
  if (!value) {
    return null;
  }

  return value.toISOString().slice(0, 10);
};

const displayValue = (value: string | null | undefined) => value || 'N/A';
const fallbackSoftwareUi = (os: string) => (os.toLowerCase().startsWith('ios') ? 'Default iOS' : null);
const dedupe = (values: string[]) => [...new Set(values)];
const formatStorageCapacity = (value: number) =>
  value >= 1024 && value % 1024 === 0 ? `${value / 1024}TB` : `${value}GB`;

export const buildDeviceDetail = (phone: DeviceWithBrand): DeviceDetail => {
  const normalizedSpecs: Record<string, Record<string, string>> = {};
  const parsedSpecs = getSpecsForDevice(phone.specBlob);
  const ramOptions = parseNumericArrayBlob(phone.performanceRamOptions);
  const storageOptions = parseNumericArrayBlob(phone.storageOptions);
  if (parsedSpecs && typeof parsedSpecs === 'object') {
    Object.entries(parsedSpecs).forEach(([key, value]) => {
      if (value && typeof value === 'object') {
        normalizedSpecs[key] = Object.entries(value).reduce(
          (acc, [k, v]) => ({ ...acc, [k.toLowerCase()]: String(v ?? '') }),
          {}
        );
      }
    });
  }

  const getSpec = (path: string[], fallback?: string) => {
    let cur: unknown = normalizedSpecs;
    for (const p of path) {
      if (!cur || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[p];
    }
    if (cur === undefined || cur === null || cur === '') {
      return fallback ?? 'N/A';
    }
    return String(cur);
  };

  const getFirstSpec = (paths: string[][], fallback = 'N/A') => {
    for (const path of paths) {
      const value = getSpec(path, '');
      if (value !== 'N/A' && value !== '') {
        return value;
      }
    }
    return fallback;
  };

  const extractRamFromInternal = () => {
    const rawRam = getFirstSpec(
      [
        ['performance', 'ram'],
        ['performance', 'internal'],
      ],
      ''
    );
    if (!rawRam || rawRam === 'N/A') {
      return 'N/A';
    }

    const matches = dedupe(
      [...rawRam.matchAll(/(\d+(?:\.\d+)?)\s*GB\s*RAM\b/gi)].map((match) => `${match[1]}GB RAM`)
    );
    return matches.length > 0 ? matches.join(', ') : 'N/A';
  };

  const extractStorageFromInternal = () => {
    const rawStorage = getFirstSpec(
      [
        ['performance', 'storage'],
        ['performance', 'internal'],
      ],
      ''
    );
    if (!rawStorage || rawStorage === 'N/A') {
      return 'N/A';
    }

    const matches = dedupe(
      [...rawStorage.matchAll(/(\d+(?:\.\d+)?)\s*(TB|GB)\b(?!\s*RAM)/gi)].map(
        (match) => `${match[1]}${match[2].toUpperCase()}`
      )
    );
    return matches.length > 0 ? matches.join(', ') : rawStorage;
  };

  const extractBatteryCapacity = () => {
    const batteryType = getSpec(['battery', 'type'], '');
    if (!batteryType || batteryType === 'N/A') {
      return 'N/A';
    }

    const match = batteryType.match(/\d{3,5}\s*mAh/i);
    return match ? match[0] : batteryType;
  };

  const extractWirelessCharging = () => {
    const charging = getSpec(['battery', 'charging'], '');
    if (!charging || charging === 'N/A') {
      return 'N/A';
    }

    const wirelessMatch = charging.match(/\d+(?:\.\d+)?W wireless[^,)]*/i);
    return wirelessMatch ? wirelessMatch[0] : charging.toLowerCase().includes('wireless') ? charging : 'N/A';
  };

  const extractRefreshRate = () => {
    const displayType = getSpec(['display', 'type'], '');
    if (!displayType || displayType === 'N/A') {
      return 'N/A';
    }

    const match = displayType.match(/\d{2,3}\s*Hz/i);
    return match ? match[0].replace(/\s+/g, '') : 'N/A';
  };

  const processor = getFirstSpec(
    [
      ['performance', 'processor'],
      ['performance', 'chipset'],
      ['performance', 'cpu'],
    ],
    phone.performanceChipset || 'N/A'
  );
  const ram = ramOptions.length > 0 ? formatOptions(ramOptions, 'GB RAM') || 'N/A' : extractRamFromInternal();
  const storage =
    storageOptions.length > 0
      ? storageOptions.map((value) => formatStorageCapacity(value)).join(', ')
      : extractStorageFromInternal();
  const batteryCapacity = getFirstSpec(
    [['battery', 'capacity']],
    formatNumber(phone.batteryCapacityMah, ' mAh') || extractBatteryCapacity()
  );
  const mainCamera = getFirstSpec(
    [
      ['camera', 'main'],
      ['camera', 'triple'],
      ['camera', 'dual'],
      ['camera', 'quad'],
      ['camera', 'single'],
    ],
    formatNumber(phone.cameraMainMp, ' MP') || 'N/A'
  );
  const frontCamera = getFirstSpec(
    [
      ['camera', 'front'],
      ['camera', 'selfie'],
      ['camera', 'single'],
    ],
    formatNumber(phone.cameraFrontMp, ' MP') || 'N/A'
  );
  const os = getFirstSpec([
    ['software', 'os'],
    ['performance', 'os'],
  ]);
  const ui = getFirstSpec(
    [
      ['software', 'ui'],
      ['software', 'user_interface'],
    ],
    fallbackSoftwareUi(os) || 'N/A'
  );

  return {
    name: phone.name,
    brand: phone.brand.name,
    model: phone.model,
    img: phone.imageUrl || 'https://via.placeholder.com/300x400?text=Phone+Image',
    rawSpecs: parsedSpecs,
    quickSpec: [
      {
        name: 'Display',
        value: displayValue(formatNumber(phone.displaySizeInches, ' in') || getSpec(['display', 'size'], '')),
      },
      { name: 'Processor', value: displayValue(processor) },
      { name: 'RAM', value: displayValue(ram) },
      { name: 'Storage', value: displayValue(storage) },
      { name: 'Battery', value: displayValue(batteryCapacity) },
      { name: 'Released', value: displayValue(formatDate(phone.releaseDate)) },
    ],
    detailSpec: [
      {
        category: 'Display',
        specifications: [
          {
            name: 'Size',
            value: displayValue(formatNumber(phone.displaySizeInches, ' in') || getSpec(['display', 'size'], '')),
          },
          {
            name: 'Resolution',
            value: displayValue(phone.displayResolution || getSpec(['display', 'resolution'], '')),
          },
          { name: 'Type', value: displayValue(phone.displayType || getSpec(['display', 'type'], '')) },
          {
            name: 'Refresh Rate',
            value: displayValue(
              formatNumber(phone.displayRefreshRate, 'Hz') || getFirstSpec([['display', 'refresh_rate']], extractRefreshRate())
            ),
          },
        ],
      },
      {
        category: 'Performance',
        specifications: [
          { name: 'Processor', value: displayValue(processor) },
          { name: 'Chipset Node', value: displayValue(formatNumber(phone.performanceChipsetNodeNm, ' nm')) },
          { name: 'RAM', value: displayValue(ram) },
          { name: 'Storage', value: displayValue(storage) },
          { name: 'GPU', value: getSpec(['performance', 'gpu']) },
        ],
      },
      {
        category: 'Camera',
        specifications: [
          { name: 'Main Camera', value: displayValue(mainCamera) },
          { name: 'Front Camera', value: displayValue(frontCamera) },
          { name: 'Video', value: getSpec(['camera', 'video']) },
        ],
      },
      {
        category: 'Battery & Charging',
        specifications: [
          { name: 'Capacity', value: displayValue(batteryCapacity) },
          {
            name: 'Wired Charging',
            value: displayValue(formatNumber(phone.batteryWiredChargingW, 'W') || getSpec(['battery', 'charging'], '')),
          },
          { name: 'Wireless Charging', value: getFirstSpec([['battery', 'wireless']], extractWirelessCharging()) },
        ],
      },
      {
        category: 'Design & Build',
        specifications: [
          { name: 'Dimensions', value: getSpec(['design', 'dimensions']) },
          { name: 'Weight', value: displayValue(formatNumber(phone.weightG, ' g') || getSpec(['design', 'weight'], '')) },
          { name: 'Materials', value: getFirstSpec([['design', 'materials'], ['design', 'build']]) },
          { name: 'Colors', value: getFirstSpec([['design', 'colors'], ['misc', 'colors']]) },
        ],
      },
      {
        category: 'Connectivity',
        specifications: [
          { name: 'Network', value: getFirstSpec([['connectivity', 'network'], ['connectivity', 'technology']]) },
          { name: 'WiFi', value: getFirstSpec([['connectivity', 'wifi'], ['connectivity', 'wlan']]) },
          { name: 'Bluetooth', value: getSpec(['connectivity', 'bluetooth']) },
          { name: 'GPS', value: getFirstSpec([['connectivity', 'gps'], ['connectivity', 'positioning']]) },
        ],
      },
      {
        category: 'Software',
        specifications: [
          { name: 'OS', value: os },
          { name: 'UI', value: displayValue(ui) },
          { name: 'Release Date', value: displayValue(formatDate(phone.releaseDate)) },
          { name: 'Discontinued', value: phone.isDiscontinued ? 'Yes' : 'No' },
        ],
      },
    ],
  };
};
