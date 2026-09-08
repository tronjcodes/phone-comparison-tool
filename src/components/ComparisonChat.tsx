'use client';

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { trackPhoneAiRequest } from '@/lib/analytics';

const DEFAULT_STARTER_PROMPTS = [
  'Summarize the biggest differences.',
  'Which one is better for battery life?',
  'Which one is the better buy for photography?',
  'Which one should I pick for everyday use?',
];

export default function ComparisonChat({
  deviceIds,
  eyebrow = 'Comparison Copilot',
  heading = 'Ask about the phones you’re comparing',
  description = 'Ask for a recommendation, a camera breakdown, battery tradeoffs, or a quick summary of the biggest differences.',
  starterPrompts = DEFAULT_STARTER_PROMPTS,
  placeholder = 'Which one is better for travel photos, battery life, and long-term value?',
  phoneAiRequestDeviceId,
}: {
  deviceIds: string[];
  eyebrow?: string;
  heading?: string;
  description?: string;
  starterPrompts?: string[];
  placeholder?: string;
  /** When set, fires a `phone_ai_request` event for this device id on ask (used on individual phone pages). */
  phoneAiRequestDeviceId?: string;
}) {
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState<string | null>(null);
  const [assistantMeta, setAssistantMeta] = useState<string | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void askAssistant();
    }
  };

  const askAssistant = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? assistantPrompt).trim();
    if (!prompt || deviceIds.length === 0) {
      return;
    }

    if (phoneAiRequestDeviceId) {
      trackPhoneAiRequest(phoneAiRequestDeviceId);
    }
    setAssistantLoading(true);
    setAssistantError(null);

    try {
      const response = await fetch('/api/compare/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceIds,
          prompt,
        }),
      });

      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.details || payload.error || 'Failed to get assistant response.');
      }

      setAssistantPrompt(prompt);
      setAssistantAnswer(payload.answer || '');
      setAssistantMeta(
        payload.source === 'openai'
          ? `Answered with OpenAI (${payload.model})`
          : payload.source === 'huggingface'
            ? `Answered with Hugging Face open model (${payload.model})`
            : payload.source === 'ollama'
              ? `Answered locally with Ollama (${payload.model})`
              : `Showing a grounded fallback because the AI provider was unavailable`
      );
    } catch (loadError) {
      setAssistantError(loadError instanceof Error ? loadError.message : 'Failed to get assistant response.');
      setAssistantAnswer(null);
      setAssistantMeta(null);
    } finally {
      setAssistantLoading(false);
    }
  };

  return (
    <section className="comparison-section assistant-section" id="ai-assistant">
      <div className="comparison-section-header">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{heading}</h2>
      </div>

      <p className="assistant-copy">{description}</p>

      <div className="assistant-prompt-list">
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="brand-pill"
            onClick={() => {
              setAssistantPrompt(prompt);
              void askAssistant(prompt);
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      <label className="assistant-field">
        <span>Your question</span>
        <textarea
          value={assistantPrompt}
          onChange={(event) => setAssistantPrompt(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder={placeholder}
          rows={4}
        />
      </label>

      <button
        type="button"
        className="primary-button compact"
        onClick={() => void askAssistant()}
        disabled={assistantLoading || assistantPrompt.trim().length === 0 || deviceIds.length === 0}
      >
        {assistantLoading ? 'Thinking...' : 'Ask comparison copilot'}
      </button>

      {assistantError && <p className="assistant-error">{assistantError}</p>}

      {assistantAnswer && (
        <div className="assistant-answer-card">
          {assistantMeta && <p className="assistant-meta">{assistantMeta}</p>}
          <div className="assistant-answer-text">{assistantAnswer}</div>
        </div>
      )}
    </section>
  );
}
