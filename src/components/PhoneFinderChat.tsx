'use client';

import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import Link from 'next/link';
import { trackPhoneRecommendationRequested } from '@/lib/analytics';

const STARTER_PROMPTS = [
  'A compact phone with a great camera',
  'Long battery life for daily use',
  'Something powerful for gaming',
];

const PHONE_IMAGE_FALLBACK = '/phone-placeholder.svg';

const phonePageHref = (deviceId: string) => {
  const [brandSlug, deviceSlug] = deviceId.split('::');
  return brandSlug && deviceSlug ? `/phones/${brandSlug}/${deviceSlug}` : null;
};

type Pick = {
  id: string;
  name: string;
  brand: string;
  img: string;
  reason: string;
  display: { sizeLabel: string | null };
  performance: { chipset: string | null; ramLabel: string | null };
  camera: { mainLabel: string | null };
  battery: { capacityLabel: string | null };
};

export type FinderDevice = {
  id: string;
  name: string;
  img: string;
  description: string;
  brand?: string;
};

export default function PhoneFinderChat({
  onAddToComparison,
  selectedDeviceIds,
}: {
  onAddToComparison: (device: FinderDevice) => void;
  selectedDeviceIds: string[];
}) {
  const [description, setDescription] = useState('');
  const [includeOlderPhones, setIncludeOlderPhones] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);

  const handleImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (!image.src.endsWith(PHONE_IMAGE_FALLBACK)) {
      image.src = PHONE_IMAGE_FALLBACK;
    }
  };

  const ask = async (promptOverride?: string) => {
    const text = (promptOverride ?? description).trim();
    if (!text) {
      return;
    }

    trackPhoneRecommendationRequested(text);
    setDescription(text);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: text, includeOlderPhones }),
      });

      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.details || payload.error || 'Failed to find phone recommendations.');
      }

      setSummary(payload.summary || '');
      setPicks(payload.picks || []);
      setMeta(
        payload.source === 'openai'
          ? `Answered with OpenAI (${payload.model})`
          : payload.source === 'huggingface'
            ? `Answered with Hugging Face open model (${payload.model})`
            : payload.source === 'ollama'
              ? `Answered locally with Ollama (${payload.model})`
              : 'Showing filtered matches because the AI provider was unavailable'
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to find phone recommendations.');
      setSummary(null);
      setPicks([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="comparison-section assistant-section finder-section">
      <div className="comparison-section-header">
        <span className="eyebrow">AI Phone Finder</span>
        <h2>Describe the phone you want</h2>
      </div>

      <p className="assistant-copy">
        Tell us what matters to you and we&rsquo;ll suggest real phones from the catalog &mdash; current
        (non-discontinued) models from the last 5 years by default. We don&rsquo;t have price data, so budget
        can&rsquo;t be factored in.
      </p>

      <div className="assistant-prompt-list">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="brand-pill"
            onClick={() => {
              setDescription(prompt);
              void ask(prompt);
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      <label className="assistant-field">
        <span>What are you looking for?</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="A compact phone with a great camera and all-day battery life"
          rows={3}
        />
      </label>

      <label className="checkbox-filter">
        <input
          type="checkbox"
          checked={includeOlderPhones}
          onChange={(event) => setIncludeOlderPhones(event.target.checked)}
        />
        <span>Include phones older than 5 years (up to 10)</span>
      </label>

      <button
        type="button"
        className="primary-button compact"
        onClick={() => void ask()}
        disabled={loading || description.trim().length === 0}
      >
        {loading ? 'Finding phones...' : 'Find phones'}
      </button>

      {error && <p className="assistant-error">{error}</p>}

      {summary && (
        <div className="assistant-answer-card">
          {meta && <p className="assistant-meta">{meta}</p>}
          <div className="assistant-answer-text">{summary}</div>
        </div>
      )}

      {picks.length > 0 && (
        <div className="results-grid finder-results-grid">
          {picks.map((pick) => {
            const isSelected = selectedDeviceIds.includes(pick.id);
            const href = phonePageHref(pick.id);

            return (
              <article key={pick.id} className="device-card">
                <div className="device-card-top">
                  <img
                    src={pick.img || PHONE_IMAGE_FALLBACK}
                    alt={pick.name}
                    width={104}
                    height={104}
                    loading="lazy"
                    decoding="async"
                    onError={handleImageError}
                  />
                  <div>
                    <p className="device-brand">{pick.brand}</p>
                    <h3>
                      {href ? (
                        <Link href={href} className="device-name-link">
                          {pick.name}
                        </Link>
                      ) : (
                        pick.name
                      )}
                    </h3>
                    <p>{pick.reason}</p>
                  </div>
                </div>

                <div className="device-card-actions">
                  <span className="result-tag">
                    {[pick.display.sizeLabel, pick.camera.mainLabel, pick.battery.capacityLabel]
                      .filter(Boolean)
                      .join(' · ') || 'Ready'}
                  </span>
                  <div className="device-card-buttons">
                    <button
                      type="button"
                      className={isSelected ? 'secondary-button' : 'primary-button compact'}
                      disabled={isSelected}
                      onClick={() =>
                        onAddToComparison({
                          id: pick.id,
                          name: pick.name,
                          img: pick.img,
                          description: pick.name,
                          brand: pick.brand,
                        })
                      }
                    >
                      {isSelected ? 'Added to compare' : 'Add to comparison'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
