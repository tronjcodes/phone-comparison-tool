import { prisma } from '@/lib/db';
import type { SizeRange } from '@/lib/phone-catalog';
import { buildPhoneSummary } from '@/lib/comparison-assistant';
import { ASSISTANT_PROVIDER, runProviderChain } from '@/lib/ai-providers';
import phoneNormalization from '@/lib/phone-normalization.js';
import type { Brand, Device } from '@prisma/client';

const { DEFAULT_IMAGE } = phoneNormalization as { DEFAULT_IMAGE: string };

const MAX_AGE_YEARS = 10;
const CANDIDATE_POOL_SIZE = 40;
const PICKS_MIN = 3;
const PICKS_MAX = 6;

const RESPONSE_CACHE_TTL_MS = 5 * 60_000;
const RESPONSE_CACHE_MAX_ENTRIES = 200;

type DeviceWithBrand = Device & { brand: Brand };
type PhoneSummary = ReturnType<typeof buildPhoneSummary>;

export type RecommendationPick = PhoneSummary & { reason: string; img: string };

export type RecommendationResponse = {
  summary: string;
  source: 'openai' | 'huggingface' | 'ollama' | 'fallback';
  model: string;
  picks: RecommendationPick[];
};

const responseCache = new Map<string, { value: RecommendationResponse; expiresAt: number }>();

const getCacheKey = (description: string) => description.trim().toLowerCase();

const setCached = (key: string, value: RecommendationResponse) => {
  if (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) {
      responseCache.delete(oldestKey);
    }
  }

  responseCache.set(key, { value, expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS });
};

type SoftFilters = {
  sizeRange?: SizeRange;
  minBattery?: number;
  minCameraMp?: number;
  minRam?: number;
  brandSlug?: string;
};

const SIZE_RANGE_CONDITIONS: Record<SizeRange, { gte?: number; lt?: number }> = {
  compact: { lt: 6 },
  standard: { gte: 6, lt: 6.7 },
  large: { gte: 6.7 },
};

/**
 * Deterministic keyword extraction - no LLM call involved. Cheap, fast, and
 * keeps the candidate-narrowing step fully inspectable/testable.
 */
const extractSoftFilters = async (description: string): Promise<SoftFilters> => {
  const text = description.toLowerCase();
  const filters: SoftFilters = {};

  if (/\b(compact|small|tiny|pocket|mini)\b/.test(text)) {
    filters.sizeRange = 'compact';
  } else if (/\b(large|big|huge)\b.*\b(screen|display)\b|\b(screen|display)\b.*\b(large|big|huge)\b/.test(text)) {
    filters.sizeRange = 'large';
  }

  if (/\b(battery|all[- ]day|long[- ]lasting|battery life)\b/.test(text)) {
    filters.minBattery = 5000;
  }

  if (/\b(camera|photo|photography|picture|selfie)\b/.test(text)) {
    filters.minCameraMp = 50;
  }

  if (/\b(gaming|game|fast|powerful|performance|flagship)\b/.test(text)) {
    filters.minRam = 8;
  }

  const brands = await prisma.brand.findMany({ select: { slug: true, name: true } });
  const matchedBrand = brands.find((brand) => text.includes(brand.name.toLowerCase()));
  if (matchedBrand) {
    filters.brandSlug = matchedBrand.slug;
  }

  return filters;
};

const buildWhereClause = (softFilters: SoftFilters) => {
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - MAX_AGE_YEARS);

  return {
    AND: [
      { isDiscontinued: false },
      { releaseDate: { gte: tenYearsAgo } },
      softFilters.sizeRange ? { displaySizeInches: SIZE_RANGE_CONDITIONS[softFilters.sizeRange] } : {},
      typeof softFilters.minBattery === 'number' ? { batteryCapacityMah: { gte: softFilters.minBattery } } : {},
      typeof softFilters.minCameraMp === 'number' ? { cameraMainMp: { gte: softFilters.minCameraMp } } : {},
      softFilters.brandSlug ? { brand: { slug: softFilters.brandSlug } } : {},
    ],
  };
};

/**
 * Fetches the bounded candidate pool the LLM will be allowed to pick from.
 * All filtering/fetching happens here in plain Prisma code - the LLM never
 * sees this function or the database, only the JSON it returns.
 */
const getCandidatePool = async (softFilters: SoftFilters): Promise<DeviceWithBrand[]> => {
  const hasMinRam = typeof softFilters.minRam === 'number';

  const fetchWith = (filters: SoftFilters) =>
    prisma.device.findMany({
      where: buildWhereClause(filters),
      include: { brand: true },
      orderBy: { releaseDate: 'desc' },
      // Same RAM caveat as searchDevices in phone-catalog.ts: performanceRamOptions
      // is JSON text in a String column, not a native array column, so "at least
      // X GB" can't be a typed Prisma filter. Fetch every DB-level match (no take
      // cap) and filter by RAM in JS below rather than risk sampling a biased
      // slice ahead of the RAM check.
      take: hasMinRam ? undefined : CANDIDATE_POOL_SIZE * 3,
    });

  const applyRamFilter = (devices: DeviceWithBrand[]) => {
    if (!hasMinRam) {
      return devices;
    }

    return devices.filter((device) => {
      try {
        const options = JSON.parse(device.performanceRamOptions || '[]') as number[];
        return Array.isArray(options) && options.some((value) => value >= softFilters.minRam!);
      } catch {
        return false;
      }
    });
  };

  let candidates = applyRamFilter(await fetchWith(softFilters));

  // If soft filters were too specific and matched nothing, progressively relax
  // them rather than ever returning an empty pool - the hard filters alone
  // (not discontinued, <=10 years old) already match thousands of real phones.
  if (candidates.length === 0 && Object.keys(softFilters).length > 0) {
    candidates = applyRamFilter(await fetchWith({}));
  }

  return candidates.slice(0, CANDIDATE_POOL_SIZE);
};

const buildRecommendationPrompt = (description: string, phones: PhoneSummary[]) => {
  const context = JSON.stringify({ phones }, null, 2);

  return [
    'You are a phone recommendation assistant.',
    'Only recommend phones from the candidate list below - never invent a phone, model, or spec that is not in the list.',
    'The candidate data does not include price at all. If the request mentions budget, price, or words like "cheap"/"affordable", do not speculate about whether any phone fits that budget or price tier - just briefly note that price data isn\'t available so you picked based on the other specs instead.',
    `Pick between ${PICKS_MIN} and ${PICKS_MAX} phones from the candidate list that best match the request.`,
    'Respond with ONLY a single JSON object in this exact shape, no markdown code fences, no other text:',
    '{ "summary": "<1-2 sentence overview of the recommendation>", "picks": [{ "id": "<candidate id, copied exactly>", "reason": "<one sentence why this fits>" }] }',
    '',
    'Candidate phones:',
    context,
    '',
    `User request: ${description}`,
  ].join('\n');
};

const parseRecommendationPayload = (raw: string): { summary: string; picks: { id: string; reason: string }[] } | null => {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const summary = (parsed as { summary?: unknown }).summary;
    const picks = (parsed as { picks?: unknown }).picks;

    if (typeof summary !== 'string' || !Array.isArray(picks)) {
      return null;
    }

    const validPicks = picks
      .filter((pick): pick is { id: unknown; reason: unknown } => !!pick && typeof pick === 'object')
      .map((pick) => ({
        id: typeof pick.id === 'string' ? pick.id : '',
        reason: typeof pick.reason === 'string' ? pick.reason : '',
      }))
      .filter((pick) => pick.id);

    return { summary, picks: validPicks };
  } catch {
    return null;
  }
};

const buildDeterministicFallback = (pool: DeviceWithBrand[]): RecommendationResponse => {
  const picks = pool.slice(0, PICKS_MAX).map((device) => ({
    ...buildPhoneSummary(device),
    reason: 'Matches your filters, sorted by most recent release.',
    img: device.imageUrl || DEFAULT_IMAGE,
  }));

  return {
    summary:
      picks.length > 0
        ? "The AI assistant isn't available right now, so here are top matches based on your description."
        : "No phones matched your description within the last 10 years of non-discontinued models. Try broadening it.",
    source: 'fallback',
    model: ASSISTANT_PROVIDER,
    picks,
  };
};

export const askPhoneRecommendation = async (description: string): Promise<RecommendationResponse> => {
  const cacheKey = getCacheKey(description);
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const softFilters = await extractSoftFilters(description);
  const pool = await getCandidatePool(softFilters);

  if (pool.length === 0) {
    const empty = buildDeterministicFallback(pool);
    setCached(cacheKey, empty);
    return empty;
  }

  const summaries = pool.map((device) => buildPhoneSummary(device));
  const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));
  const imageById = new Map(pool.map((device) => [`${device.brand.slug}::${device.slug}`, device.imageUrl || DEFAULT_IMAGE]));

  const prompt = buildRecommendationPrompt(description, summaries);
  const result = await runProviderChain(prompt);

  if (result) {
    const parsed = parseRecommendationPayload(result.answer);

    if (parsed) {
      const picks: RecommendationPick[] = parsed.picks
        .map((pick) => {
          const summary = summaryById.get(pick.id);
          return summary
            ? { ...summary, reason: pick.reason || '', img: imageById.get(pick.id) || DEFAULT_IMAGE }
            : null;
        })
        .filter((pick): pick is RecommendationPick => pick !== null);

      if (picks.length > 0) {
        const response: RecommendationResponse = {
          summary: parsed.summary,
          source: result.source,
          model: result.model,
          picks,
        };

        setCached(cacheKey, response);
        return response;
      }
    }
  }

  const fallback = buildDeterministicFallback(pool);
  setCached(cacheKey, fallback);
  return fallback;
};
