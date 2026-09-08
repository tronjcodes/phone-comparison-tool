import { NextResponse } from 'next/server';
import { askPhoneRecommendation } from '@/lib/phone-recommendation';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_DESCRIPTION_LENGTH = 500;

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`recommend:${clientIp}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);

  if (!rateLimit.allowed) {
    console.warn(`[rate-limit] blocked ip=${clientIp} route=/api/recommend`);
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment before trying again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))),
        },
      }
    );
  }

  try {
    const body = (await request.json()) as { description?: string; includeOlderPhones?: boolean };
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const includeOlderPhones = body.includeOlderPhones === true;

    if (!description) {
      return NextResponse.json({ error: 'Describe the phone you\'re looking for.' }, { status: 400 });
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `Your description is too long (max ${MAX_DESCRIPTION_LENGTH} characters).` },
        { status: 400 }
      );
    }

    const result = await askPhoneRecommendation(description, includeOlderPhones);

    return NextResponse.json({
      summary: result.summary,
      source: result.source,
      model: result.model,
      picks: result.picks,
    });
  } catch (error) {
    console.error('[recommend] request failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      {
        error: 'Failed to find phone recommendations.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
