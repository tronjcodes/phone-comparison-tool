import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first request for a fresh key with remaining = limit - 1', () => {
    const result = checkRateLimit('key-a', 3, 60_000);
    expect(result).toEqual({ allowed: true, remaining: 2, resetAt: Date.now() + 60_000 });
  });

  it('decrements remaining on subsequent requests within the window', () => {
    checkRateLimit('key-b', 3, 60_000);
    const second = checkRateLimit('key-b', 3, 60_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it('denies the request that exceeds the limit', () => {
    checkRateLimit('key-c', 2, 60_000);
    checkRateLimit('key-c', 2, 60_000);
    const third = checkRateLimit('key-c', 2, 60_000);
    expect(third).toEqual({ allowed: false, remaining: 0, resetAt: expect.any(Number) });
  });

  it('resets the bucket once the window has passed', () => {
    checkRateLimit('key-d', 1, 60_000);
    const withinWindow = checkRateLimit('key-d', 1, 60_000);
    expect(withinWindow.allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    const afterReset = checkRateLimit('key-d', 1, 60_000);
    expect(afterReset).toEqual({ allowed: true, remaining: 0, resetAt: Date.now() + 60_000 });
  });

  it('tracks separate keys independently', () => {
    checkRateLimit('key-e', 1, 60_000);
    const otherKey = checkRateLimit('key-f', 1, 60_000);
    expect(otherKey.allowed).toBe(true);
  });
});

describe('getClientIp', () => {
  it('prefers the first entry of x-forwarded-for, trimmed', () => {
    const request = new Request('http://example.com', {
      headers: { 'x-forwarded-for': ' 203.0.113.5 , 70.41.3.18' },
    });
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const request = new Request('http://example.com', {
      headers: { 'x-real-ip': '198.51.100.7' },
    });
    expect(getClientIp(request)).toBe('198.51.100.7');
  });

  it('falls back to "unknown" when neither header is present', () => {
    const request = new Request('http://example.com');
    expect(getClientIp(request)).toBe('unknown');
  });
});
