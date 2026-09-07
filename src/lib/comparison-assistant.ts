import { getDeviceByEncodedId, getSpecsForDevice } from '@/lib/phone-catalog';
import phoneNormalization from '@/lib/phone-normalization.js';
import { ASSISTANT_PROVIDER, runProviderChain, type ProviderSource } from '@/lib/ai-providers';

const { parseNumericArrayBlob } = phoneNormalization as {
  parseNumericArrayBlob: (value: string | null) => number[];
};

type DeviceRecord = Awaited<ReturnType<typeof getDeviceByEncodedId>>;
type PresentDeviceRecord = NonNullable<DeviceRecord>;

const RESPONSE_CACHE_TTL_MS = 5 * 60_000;
const RESPONSE_CACHE_MAX_ENTRIES = 200;

type AssistantResponse = {
  answer: string;
  source: ProviderSource;
  model: string;
  phones: ReturnType<typeof buildPhoneSummary>[];
};

const responseCache = new Map<string, { value: AssistantResponse; expiresAt: number }>();

const getCacheKey = (question: string, deviceIds: string[]) =>
  `${[...deviceIds].sort().join(',')}::${question.trim().toLowerCase()}`;

const setCached = (key: string, value: AssistantResponse) => {
  if (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) {
      responseCache.delete(oldestKey);
    }
  }

  responseCache.set(key, { value, expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS });
};

const formatNumber = (value: number | null | undefined, suffix?: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return `${value}${suffix || ''}`;
};

const formatDate = (value: Date | null | undefined) => {
  if (!value) {
    return null;
  }

  return value.toISOString().slice(0, 10);
};

const formatStorageCapacity = (value: number) => (value >= 1024 && value % 1024 === 0 ? `${value / 1024}TB` : `${value}GB`);

const formatArray = (values: number[], formatter: (value: number) => string) =>
  values.length > 0 ? values.map(formatter).join(', ') : null;

const getSpec = (specs: Record<string, Record<string, string>>, path: string[]) => {
  let current: unknown = specs;
  for (const part of path) {
    if (!current || typeof current !== 'object') {
      return null;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === 'string' && current ? current : null;
};

const getFirstSpec = (specs: Record<string, Record<string, string>>, paths: string[][]) => {
  for (const path of paths) {
    const value = getSpec(specs, path);
    if (value) {
      return value;
    }
  }

  return null;
};

export const buildPhoneSummary = (phone: PresentDeviceRecord) => {
  const specs = getSpecsForDevice(phone.specBlob);
  const ramOptions = parseNumericArrayBlob(phone.performanceRamOptions);
  const storageOptions = parseNumericArrayBlob(phone.storageOptions);

  return {
    id: `${phone.brand.slug}::${phone.slug}`,
    name: phone.name,
    brand: phone.brand.name,
    releaseDate: formatDate(phone.releaseDate),
    discontinued: phone.isDiscontinued,
    display: {
      sizeInches: phone.displaySizeInches,
      sizeLabel: formatNumber(phone.displaySizeInches, ' in') || getSpec(specs, ['display', 'size']),
      type: phone.displayType || getSpec(specs, ['display', 'type']),
      resolution: phone.displayResolution || getSpec(specs, ['display', 'resolution']),
      refreshRate: phone.displayRefreshRate,
      refreshRateLabel: formatNumber(phone.displayRefreshRate, 'Hz'),
    },
    performance: {
      chipset: phone.performanceChipset || getFirstSpec(specs, [['performance', 'processor'], ['performance', 'chipset']]),
      chipsetNodeNm: phone.performanceChipsetNodeNm,
      ramOptions,
      ramLabel:
        formatArray(ramOptions, (value) => `${value}GB RAM`) ||
        getFirstSpec(specs, [['performance', 'ram'], ['performance', 'internal']]),
      storageOptions,
      storageLabel:
        formatArray(storageOptions, formatStorageCapacity) ||
        getFirstSpec(specs, [['performance', 'storage'], ['performance', 'internal']]),
    },
    camera: {
      mainMp: phone.cameraMainMp,
      frontMp: phone.cameraFrontMp,
      mainLabel: formatNumber(phone.cameraMainMp, ' MP') || getFirstSpec(specs, [['camera', 'main'], ['camera', 'triple'], ['camera', 'dual']]),
      frontLabel: formatNumber(phone.cameraFrontMp, ' MP') || getFirstSpec(specs, [['camera', 'front'], ['camera', 'selfie']]),
      video: getSpec(specs, ['camera', 'video']),
    },
    battery: {
      capacityMah: phone.batteryCapacityMah,
      capacityLabel: formatNumber(phone.batteryCapacityMah, ' mAh') || getFirstSpec(specs, [['battery', 'capacity'], ['battery', 'type']]),
      wiredChargingW: phone.batteryWiredChargingW,
      wiredChargingLabel:
        formatNumber(phone.batteryWiredChargingW, 'W') || getSpec(specs, ['battery', 'charging']),
    },
    build: {
      weightG: phone.weightG,
      weightLabel: formatNumber(phone.weightG, ' g') || getSpec(specs, ['design', 'weight']),
      dimensions: getSpec(specs, ['design', 'dimensions']),
      materials: getFirstSpec(specs, [['design', 'materials'], ['design', 'build']]),
      network: getFirstSpec(specs, [['connectivity', 'network'], ['connectivity', 'technology']]),
      wifi: getFirstSpec(specs, [['connectivity', 'wifi'], ['connectivity', 'wlan']]),
      bluetooth: getSpec(specs, ['connectivity', 'bluetooth']),
      gps: getFirstSpec(specs, [['connectivity', 'gps'], ['connectivity', 'positioning']]),
      os: getFirstSpec(specs, [['software', 'os'], ['performance', 'os']]),
    },
  };
};

const buildComparisonPrompt = (question: string, phones: ReturnType<typeof buildPhoneSummary>[]) => {
  const context = JSON.stringify({ phones }, null, 2);

  const isSinglePhone = phones.length === 1;

  return [
    isSinglePhone
      ? 'You are a phone specification assistant answering questions about a single phone.'
      : 'You are a phone comparison assistant.',
    'Answer only using the structured phone data provided.',
    'Do not invent prices, benchmark scores, availability, or features that are not in the data.',
    'If the data is missing, say so clearly.',
    isSinglePhone
      ? 'If the user asks how this phone compares to another phone that is not in the data, say you don\'t have that phone\'s specs and suggest using the comparison tool.'
      : 'When comparing a specific attribute across phones, first line up each phone\'s exact value for that attribute, then check which value actually wins (e.g. the higher number, or whether values are tied) before writing your conclusion.',
    isSinglePhone
      ? 'Focus on helping a consumer decide whether this phone is right for them.'
      : 'Focus on helping a consumer decide between the phones in the comparison.',
    'Keep the answer concise, practical, and easy to scan.',
    '',
    isSinglePhone ? 'Phone data:' : 'Comparison data:',
    context,
    '',
    `User question: ${question}`,
  ].join('\n');
};

const buildFallbackAnswer = (question: string, phones: ReturnType<typeof buildPhoneSummary>[]) => {
  const bullets = phones.map((phone) => {
    const parts = [
      phone.display.sizeLabel && `display ${phone.display.sizeLabel}`,
      phone.display.refreshRateLabel && phone.display.refreshRateLabel,
      phone.performance.chipset && phone.performance.chipset,
      phone.performance.ramLabel && `RAM ${phone.performance.ramLabel}`,
      phone.performance.storageLabel && `storage ${phone.performance.storageLabel}`,
      phone.battery.capacityLabel && `battery ${phone.battery.capacityLabel}`,
      phone.build.weightLabel && `weight ${phone.build.weightLabel}`,
      phone.camera.mainLabel && `main camera ${phone.camera.mainLabel}`,
    ].filter(Boolean);

    return `- ${phone.name}: ${parts.join(', ')}`;
  });

  return [
    `The AI assistant isn't available right now, so here's a grounded summary based on the spec sheet for: "${question}"`,
    '',
    ...bullets,
  ].join('\n');
};

export const buildComparisonAssistantContext = async (deviceIds: string[]) => {
  const devices = await Promise.all(deviceIds.map((deviceId) => getDeviceByEncodedId(deviceId)));
  const phones = devices
    .filter((device): device is PresentDeviceRecord => device !== null)
    .map((device) => buildPhoneSummary(device));

  return phones;
};

export const askComparisonAssistant = async (question: string, deviceIds: string[]): Promise<AssistantResponse> => {
  const cacheKey = getCacheKey(question, deviceIds);
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const phones = await buildComparisonAssistantContext(deviceIds);

  if (phones.length < 1) {
    throw new Error('Select at least one phone before asking a question.');
  }

  const prompt = buildComparisonPrompt(question, phones);
  const result = await runProviderChain(prompt);

  if (result) {
    const response: AssistantResponse = {
      answer: result.answer,
      source: result.source,
      model: result.model,
      phones,
    };

    setCached(cacheKey, response);
    return response;
  }

  return {
    answer: buildFallbackAnswer(question, phones),
    source: 'fallback',
    model: ASSISTANT_PROVIDER,
    phones,
  };
};
