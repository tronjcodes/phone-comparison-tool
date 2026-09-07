import { prisma } from '@/lib/db';
import phoneNormalization from '@/lib/phone-normalization.js';

type SpecSections = Record<string, Record<string, string>>;

export const encodeDeviceId = (brandSlug: string, deviceSlug: string) => `${brandSlug}::${deviceSlug}`;

const decodeDeviceId = (value: string) => {
  const [brandSlug, deviceSlug] = value.split('::');
  if (!brandSlug || !deviceSlug) {
    return null;
  }

  return { brandSlug, deviceSlug };
};

const {
  DEFAULT_IMAGE,
  parseSpecBlob,
  slugify,
} = phoneNormalization as {
  DEFAULT_IMAGE: string;
  parseSpecBlob: (specBlob: string | null) => SpecSections;
  slugify: (value: string) => string;
};

export const getBrands = async () => {
  const brands = await prisma.brand.findMany({
    include: {
      _count: {
        select: { devices: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  return brands.map((brand) => ({
    id: brand.slug,
    name: brand.name,
    brand: brand.slug,
    devices: brand._count.devices,
  }));
};

export const getReleaseYears = async () => {
  const devices = await prisma.device.findMany({
    where: {
      releaseDate: { not: null },
    },
    select: {
      releaseDate: true,
    },
  });

  return Array.from(
    new Set(
      devices
        .map((device) => device.releaseDate?.getUTCFullYear())
        .filter((year): year is number => typeof year === 'number' && Number.isFinite(year))
    )
  ).sort((a, b) => b - a);
};

export const getDevicesByBrand = async (brandSlug: string) => {
  const brand = await prisma.brand.findUnique({
    where: { slug: brandSlug },
    include: {
      devices: {
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!brand) {
    return [];
  }

  return brand.devices.map((device) => ({
    id: encodeDeviceId(brand.slug, device.slug),
    name: device.name,
    img: device.imageUrl || DEFAULT_IMAGE,
    description: device.model,
    brand: brand.name,
  }));
};

export type SizeRange = 'compact' | 'standard' | 'large';

const SIZE_RANGE_CONDITIONS: Record<SizeRange, { gte?: number; lt?: number }> = {
  compact: { lt: 6 },
  standard: { gte: 6, lt: 6.7 },
  large: { gte: 6.7 },
};

export const searchDevices = async (
  query: string,
  brandSlug?: string,
  releaseYear?: number,
  sizeRange?: SizeRange,
  minBattery?: number,
  minRam?: number,
  availableOnly?: boolean
) => {
  const normalizedQuery = query.trim();
  const hasReleaseYear = typeof releaseYear === 'number' && Number.isFinite(releaseYear);
  const hasMinBattery = typeof minBattery === 'number' && Number.isFinite(minBattery);
  const hasMinRam = typeof minRam === 'number' && Number.isFinite(minRam);

  const devices = await prisma.device.findMany({
    where: {
      AND: [
        brandSlug
          ? {
              brand: {
                slug: brandSlug,
              },
            }
          : {},
        hasReleaseYear
          ? {
              releaseDate: {
                gte: new Date(Date.UTC(releaseYear, 0, 1)),
                lt: new Date(Date.UTC(releaseYear + 1, 0, 1)),
              },
            }
          : {},
        sizeRange
          ? {
              displaySizeInches: SIZE_RANGE_CONDITIONS[sizeRange],
            }
          : {},
        hasMinBattery
          ? {
              batteryCapacityMah: { gte: minBattery },
            }
          : {},
        availableOnly
          ? {
              isDiscontinued: false,
            }
          : {},
        normalizedQuery
          ? {
              OR: [
                { name: { contains: normalizedQuery, mode: 'insensitive' } },
                { model: { contains: normalizedQuery, mode: 'insensitive' } },
                {
                  brand: {
                    name: { contains: normalizedQuery, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {},
      ],
    },
    include: {
      brand: true,
    },
    orderBy: [
      { brand: { name: 'asc' } },
      { name: 'asc' },
    ],
    // performanceRamOptions is a JSON-stringified array in a String column, not a
    // native array/JSON column, so "at least X GB" can't be expressed as a typed
    // Prisma filter. When a RAM filter is active, fetch every candidate matching
    // the other (DB-level) filters with no cap - a fixed-size window here would
    // sample a biased alphabetical slice (e.g. "AT&T"/"Acer"/"Alcatel" devices
    // sort first and rarely have high RAM, undercounting real matches) - then do
    // the RAM check in JS below and slice down to the normal page size.
    take: hasMinRam ? undefined : 60,
  });

  const filteredByRam = hasMinRam
    ? devices.filter((device) => {
        try {
          const options = JSON.parse(device.performanceRamOptions || '[]') as number[];
          return Array.isArray(options) && options.some((value) => value >= minRam);
        } catch {
          return false;
        }
      })
    : devices;

  return filteredByRam.slice(0, 60).map((device) => ({
    id: encodeDeviceId(device.brand.slug, device.slug),
    name: device.name,
    img: device.imageUrl || DEFAULT_IMAGE,
    description: `${device.brand.name} ${device.model}`.trim(),
    brand: device.brand.name,
  }));
};

export const getDeviceByEncodedId = async (encodedId: string) => {
  const decoded = decodeDeviceId(encodedId);
  if (!decoded) {
    return null;
  }

  return prisma.device.findFirst({
    where: {
      slug: decoded.deviceSlug,
      brand: {
        slug: decoded.brandSlug,
      },
    },
    include: {
      brand: true,
    },
  });
};

export const getDeviceByBrandModel = async (brandNameOrSlug: string, modelNameOrSlug: string) => {
  const brandSlug = slugify(brandNameOrSlug);
  const deviceSlug = slugify(modelNameOrSlug);

  return prisma.device.findFirst({
    where: {
      slug: deviceSlug,
      brand: {
        slug: brandSlug,
      },
    },
    include: {
      brand: true,
    },
  });
};

export const getSpecsForDevice = (specBlob: string | null) => parseSpecBlob(specBlob);
