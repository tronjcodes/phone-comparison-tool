import { NextResponse } from 'next/server';
import { searchDevices } from '@/lib/phone-catalog';
import type { SizeRange } from '@/lib/phone-catalog';

export const dynamic = 'force-dynamic';

const VALID_SIZE_RANGES: SizeRange[] = ['compact', 'standard', 'large'];

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const brand = url.searchParams.get('brand') || undefined;
    const yearParam = url.searchParams.get('year');
    const releaseYear = yearParam ? Number.parseInt(yearParam, 10) : undefined;
    const sizeParam = url.searchParams.get('size');
    const sizeRange = VALID_SIZE_RANGES.includes(sizeParam as SizeRange) ? (sizeParam as SizeRange) : undefined;
    const minBatteryParam = url.searchParams.get('minBattery');
    const minBattery = minBatteryParam ? Number.parseInt(minBatteryParam, 10) : undefined;
    const minRamParam = url.searchParams.get('minRam');
    const minRam = minRamParam ? Number.parseInt(minRamParam, 10) : undefined;
    const availableOnly = url.searchParams.get('availableOnly') === 'true';

    const devices = await searchDevices(
      query,
      brand,
      typeof releaseYear === 'number' && Number.isFinite(releaseYear) ? releaseYear : undefined,
      sizeRange,
      typeof minBattery === 'number' && Number.isFinite(minBattery) ? minBattery : undefined,
      typeof minRam === 'number' && Number.isFinite(minRam) ? minRam : undefined,
      availableOnly
    );

    return NextResponse.json({
      devices,
      total: devices.length,
      message: 'Search results from the local catalog',
    });
  } catch (error) {
    console.error('Error searching devices:', error);

    return NextResponse.json(
      {
        error: 'Failed to search devices',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
