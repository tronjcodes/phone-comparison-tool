'use client';

import { track } from '@vercel/analytics';

export const trackPhoneView = (deviceId: string) => track('phone_view', { deviceId });

export const trackCompareClicked = (deviceId: string) => track('compare_clicked', { deviceId });

export const trackAffiliateClick = (deviceId: string, retailer: string) =>
  track('affiliate_click', { deviceId, retailer });

export const trackPhoneAiRequest = (deviceId: string) => track('phone_ai_request', { deviceId });

export const trackSearchCtaClicked = () => track('search_cta_clicked');

export const trackFinderCtaClicked = () => track('finder_cta_clicked');

export const trackSearchInputFocused = () => track('search_input_focused');

export const trackPhoneSearch = (query: string, resultCount: number) =>
  track('phone_search', { query, resultCount });

export const trackPhoneSelected = (deviceId: string) => track('phone_selected', { deviceId });

export const trackCompareStarted = (deviceCount: number) => track('compare_started', { deviceCount });

export const trackPhoneRecommendationRequested = (description: string) =>
  track('phone_recommendation_requested', { description });
