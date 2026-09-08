'use client';

import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import PhoneFinderChat from '@/components/PhoneFinderChat';
import {
  trackSearchCtaClicked,
  trackFinderCtaClicked,
  trackSearchInputFocused,
  trackPhoneSearch,
  trackPhoneSelected,
  trackCompareStarted,
} from '@/lib/analytics';

interface Brand {
  id: string;
  name: string;
  devices: number;
  brand: string;
}

interface Device {
  id: string;
  name: string;
  img: string;
  description: string;
  brand?: string;
}

interface DeviceDetail {
  name: string;
  img: string;
  brand?: string;
  model?: string;
}

const MAX_COMPARE = 4;
const PHONE_IMAGE_FALLBACK = '/phone-placeholder.svg';
const WORKSPACE_STORAGE_KEY = 'differenceai:selectedDevices';

const readStoredDevices = (): Device[] => {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStoredDevices = (devices: Device[]) => {
  try {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(devices));
  } catch {
    // Storage unavailable (e.g. private browsing) - fail silently, nothing to persist.
  }
};

const phonePageHref = (deviceId: string) => {
  const [brandSlug, deviceSlug] = deviceId.split('::');
  return brandSlug && deviceSlug ? `/phones/${brandSlug}/${deviceSlug}` : null;
};

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [releaseYears, setReleaseYears] = useState<number[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [selectedReleaseYear, setSelectedReleaseYear] = useState<string>('');
  const [selectedSizeRange, setSelectedSizeRange] = useState<string>('');
  const [selectedMinBattery, setSelectedMinBattery] = useState<string>('');
  const [selectedMinRam, setSelectedMinRam] = useState<string>('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<Device[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Device[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const hasActiveSearch =
    searchTerm.trim().length > 0 ||
    selectedBrand.length > 0 ||
    selectedReleaseYear.length > 0 ||
    selectedSizeRange.length > 0 ||
    selectedMinBattery.length > 0 ||
    selectedMinRam.length > 0 ||
    availableOnly;
  const searchSectionRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetchBrands();
  }, []);

  useEffect(() => {
    const stored = readStoredDevices();
    if (stored.length > 0) {
      setSelectedDevices(stored);
    }
    // Restore once on mount; this is a persistence read, not a fresh user
    // selection, so it deliberately bypasses addToComparison's tracking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeStoredDevices(selectedDevices);
  }, [selectedDevices]);

  useEffect(() => {
    const idsParam = searchParams.get('devices');
    if (!idsParam) {
      return;
    }

    const ids = idsParam.split(',').filter(Boolean).slice(0, MAX_COMPARE);
    ids.forEach((id) => void addDeviceById(id));
    // Runs once on mount to hydrate the workspace from a "Compare this phone" link;
    // not re-run on every searchParams change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasActiveSearch) {
      setResults([]);
      setLoadingResults(false);
      return;
    }

    const timeout = setTimeout(() => {
      void searchDevices(
        searchTerm,
        selectedBrand,
        selectedReleaseYear,
        selectedSizeRange,
        selectedMinBattery,
        selectedMinRam,
        availableOnly
      );
    }, 200);

    return () => clearTimeout(timeout);
  }, [
    searchTerm,
    selectedBrand,
    selectedReleaseYear,
    selectedSizeRange,
    selectedMinBattery,
    selectedMinRam,
    availableOnly,
    hasActiveSearch,
  ]);

  const fetchBrands = async () => {
    try {
      const response = await fetch('/api/phones');
      const data = await response.json();
      setBrands(data.brands || []);
      setReleaseYears(data.releaseYears || []);
    } catch (error) {
      console.error('Error fetching brands:', error);
      setBrands([]);
      setReleaseYears([]);
    } finally {
      setLoadingBrands(false);
    }
  };

  const searchDevices = async (
    query: string,
    brand: string,
    releaseYear: string,
    sizeRange: string,
    minBattery: string,
    minRam: string,
    availableOnlyFilter: boolean
  ) => {
    setLoadingResults(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (brand) params.set('brand', brand);
      if (releaseYear) params.set('year', releaseYear);
      if (sizeRange) params.set('size', sizeRange);
      if (minBattery) params.set('minBattery', minBattery);
      if (minRam) params.set('minRam', minRam);
      if (availableOnlyFilter) params.set('availableOnly', 'true');

      const response = await fetch(`/api/phones/search?${params.toString()}`);
      const data = await response.json();
      const devices = data.devices || [];
      setResults(devices);
      trackPhoneSearch(query, devices.length);
    } catch (error) {
      console.error('Error searching devices:', error);
      setResults([]);
    } finally {
      setLoadingResults(false);
    }
  };

  const addToComparison = (device: Device) => {
    const alreadySelected = selectedDevices.some((item) => item.id === device.id);
    const atLimit = selectedDevices.length >= MAX_COMPARE;
    if (!alreadySelected && !atLimit) {
      trackPhoneSelected(device.id);
    }

    setSelectedDevices((current) => {
      if (current.some((item) => item.id === device.id) || current.length >= MAX_COMPARE) {
        return current;
      }

      return [...current, device];
    });
  };

  const addDeviceById = async (deviceId: string) => {
    try {
      const response = await fetch(`/api/phones/device/${encodeURIComponent(deviceId)}`);
      const payload = await response.json();

      if (!response.ok || payload.error) {
        return;
      }

      const detail: DeviceDetail = payload.device;
      addToComparison({
        id: deviceId,
        name: detail.name,
        img: detail.img,
        description: detail.model || detail.name,
        brand: detail.brand,
      });
    } catch (error) {
      console.error('Error preloading device into workspace:', error);
    }
  };

  const handleDeviceImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.src.endsWith(PHONE_IMAGE_FALLBACK)) {
      return;
    }

    image.src = PHONE_IMAGE_FALLBACK;
  };

  const removeFromComparison = (deviceId: string) => {
    setSelectedDevices((current) => current.filter((device) => device.id !== deviceId));
  };

  const submitComparison = () => {
    if (selectedDevices.length < 2) {
      return;
    }

    trackCompareStarted(selectedDevices.length);
    const ids = selectedDevices.map((device) => device.id).join(',');
    router.push(`/compare?devices=${ids}`);
  };

  const handleFinderCtaClick = () => {
    trackFinderCtaClicked();

    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('phone-finder-section')?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const handleSearchCtaClick = () => {
    trackSearchCtaClicked();
    // Focus first (synchronously, within the click handler) so iOS Safari still
    // treats it as part of the user gesture and opens the keyboard; preventScroll
    // avoids the browser's own focus-scroll fighting with our smooth scroll below.
    searchInputRef.current?.focus({ preventScroll: true });

    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    searchSectionRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const activeBrandName = brands.find((brand) => brand.id === selectedBrand)?.name || 'All brands';
  const activeReleaseYearLabel = selectedReleaseYear ? `Released in ${selectedReleaseYear}` : 'Any release year';
  const totalDevices = brands.reduce((sum, brand) => sum + brand.devices, 0);

  return (
    <main className="catalog-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="brand-mark">
            difference<span className="brand-mark-accent">AI</span>
          </div>
          <span className="eyebrow">The AI-powered smartphone comparison engine.</span>
          <h1>Compare phones. Know the difference.</h1>
          <p>
            Compare specs side by side and see which phone comes out ahead.
          </p>
          <div className="hero-cta-row">
            <button type="button" className="primary-button search-cta" onClick={handleFinderCtaClick}>
              Describe what you want <span aria-hidden="true">&darr;</span>
            </button>
            <button type="button" className="primary-button search-cta" onClick={handleSearchCtaClick}>
              Search phones <span aria-hidden="true">&darr;</span>
            </button>
          </div>
          <div className="hero-stats">
            <div>
              <strong>{brands.length}</strong>
              <span>Brands indexed</span>
            </div>
            <div>
              <strong>{totalDevices}</strong>
              <span>Devices searchable</span>
            </div>
            <div>
              <strong>{selectedDevices.length}/{MAX_COMPARE}</strong>
              <span>Chosen to compare</span>
            </div>
          </div>
        </div>

        <div className="selection-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Comparison workspace</p>
              <h2>Build a side-by-side comparison set</h2>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setSelectedDevices([])}
              disabled={selectedDevices.length === 0}
            >
              Clear
            </button>
          </div>

          <div className="selected-grid">
            {selectedDevices.length === 0 && (
              <div className="empty-card">
                Pick at least two devices to unlock the comparison button.
              </div>
            )}

            {selectedDevices.map((device) => (
              <article key={device.id} className="selected-card">
                <img
                  src={device.img || PHONE_IMAGE_FALLBACK}
                  alt={device.name}
                  width={88}
                  height={88}
                  loading="lazy"
                  decoding="async"
                  onError={handleDeviceImageError}
                />
                <div>
                  <p className="device-brand">{device.brand || 'Catalog device'}</p>
                  <h3>
                    {phonePageHref(device.id) ? (
                      <Link href={phonePageHref(device.id)!} className="device-name-link">
                        {device.name}
                      </Link>
                    ) : (
                      device.name
                    )}
                  </h3>
                  <p>{device.description}</p>
                </div>
                <button type="button" className="remove-button" onClick={() => removeFromComparison(device.id)}>
                  Remove
                </button>
              </article>
            ))}
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={submitComparison}
            disabled={selectedDevices.length < 2}
          >
            Compare selected devices
          </button>
        </div>
      </section>

      <PhoneFinderChat
        onAddToComparison={addToComparison}
        selectedDeviceIds={selectedDevices.map((device) => device.id)}
      />

      <section className="search-panel" id="search-section" ref={searchSectionRef}>
        <div className="panel-header search-header">
          <div>
            <p className="panel-kicker">Search everything</p>
            <h2>Search phones</h2>
            <p>Find any phone in the {totalDevices}+ device catalog.</p>
          </div>
        </div>

        <div className="search-controls">
          <label className="search-input">
            <span>Search by model, phone name, or brand</span>
            <input
              ref={searchInputRef}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onFocus={() => trackSearchInputFocused()}
              placeholder="Try iPhone 17, Pixel 11, Galaxy Z Fold8, BlackBerry..."
            />
          </label>

          <label className="brand-select">
            <span>Brand filter</span>
            <select value={selectedBrand} onChange={(event) => setSelectedBrand(event.target.value)}>
              <option value="">All brands</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name} ({brand.devices})
                </option>
              ))}
            </select>
          </label>

          <label className="brand-select">
            <span>Release year</span>
            <select value={selectedReleaseYear} onChange={(event) => setSelectedReleaseYear(event.target.value)}>
              <option value="">Any year</option>
              {releaseYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="brand-select">
            <span>Screen size</span>
            <select value={selectedSizeRange} onChange={(event) => setSelectedSizeRange(event.target.value)}>
              <option value="">Any size</option>
              <option value="compact">Compact (under 6&quot;)</option>
              <option value="standard">Standard (6&quot;&ndash;6.7&quot;)</option>
              <option value="large">Large (6.7&quot;+)</option>
            </select>
          </label>

          <label className="brand-select">
            <span>Battery</span>
            <select value={selectedMinBattery} onChange={(event) => setSelectedMinBattery(event.target.value)}>
              <option value="">Any battery</option>
              <option value="4000">4000mAh+</option>
              <option value="5000">5000mAh+</option>
              <option value="6000">6000mAh+</option>
            </select>
          </label>

          <label className="brand-select">
            <span>RAM</span>
            <select value={selectedMinRam} onChange={(event) => setSelectedMinRam(event.target.value)}>
              <option value="">Any RAM</option>
              <option value="6">6GB+</option>
              <option value="8">8GB+</option>
              <option value="12">12GB+</option>
            </select>
          </label>

          <label className="checkbox-filter">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(event) => setAvailableOnly(event.target.checked)}
            />
            <span>Currently available only</span>
          </label>
        </div>

        <div className="results-meta">
          <div>
            <strong>{activeBrandName}</strong>
            <span>
              {loadingBrands
                ? 'Loading filters...'
                : hasActiveSearch
                  ? `${activeReleaseYearLabel} · ${results.length} searchable result${results.length === 1 ? '' : 's'}`
                  : 'Select a brand, release year, or search term to see devices'}
            </span>
          </div>
          {loadingResults && <span className="loading-chip">Updating results...</span>}
        </div>

        <div className="results-grid">
          {!loadingResults && !hasActiveSearch && (
            <div className="empty-results">
              <h3>Start with a filter</h3>
              <p>Select a brand, choose a release year, or search for a model to load matching phones.</p>
            </div>
          )}

          {!loadingResults && hasActiveSearch && results.length === 0 && (
            <div className="empty-results">
              <h3>No devices matched</h3>
              <p>Try a broader search or clear one of the filters.</p>
            </div>
          )}

          {results.map((device) => {
            const isSelected = selectedDevices.some((item) => item.id === device.id);
            const isDisabled = !isSelected && selectedDevices.length >= MAX_COMPARE;

            return (
              <article key={device.id} className="device-card">
                <div className="device-card-top">
                  <img
                    src={device.img || PHONE_IMAGE_FALLBACK}
                    alt={device.name}
                    width={104}
                    height={104}
                    loading="lazy"
                    decoding="async"
                    onError={handleDeviceImageError}
                  />
                  <div>
                    <p className="device-brand">{device.brand || 'Catalog device'}</p>
                    <h3>
                      {phonePageHref(device.id) ? (
                        <Link href={phonePageHref(device.id)!} className="device-name-link">
                          {device.name}
                        </Link>
                      ) : (
                        device.name
                      )}
                    </h3>
                    <p>{device.description}</p>
                  </div>
                </div>

                <div className="device-card-actions">
                  <span className="result-tag">{isSelected ? 'Selected' : 'Ready'}</span>
                  <div className="device-card-buttons">
                    {phonePageHref(device.id) && (
                      <Link href={`${phonePageHref(device.id)}#ai-assistant`} className="ghost-link">
                        Ask AI
                      </Link>
                    )}
                    <button
                      type="button"
                      className={isSelected ? 'secondary-button' : 'primary-button compact'}
                      disabled={isDisabled || isSelected}
                      onClick={() => addToComparison(device)}
                    >
                      {isSelected ? 'Added to compare' : 'Add to comparison'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

    </main>
  );
}
