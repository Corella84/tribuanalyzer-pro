// lib/api/meta-ads.ts
// Funciones específicas para interactuar con la API de Meta Ads del backend Flask

import { apiClient } from './client';
import type { MetaCampaign, MetaInsights, CampaignData, DateRange } from '../types/meta-ads';

/**
 * Obtiene todas las campañas de Meta Ads
 */
export async function getCampaigns(): Promise<MetaCampaign[]> {
  return apiClient.get<MetaCampaign[]>('/api/campaigns');
}

/**
 * Obtiene los insights de una campaña específica
 */
export async function getCampaignInsights(
  campaignId: string,
  dateRange?: DateRange
): Promise<MetaInsights> {
  const params = dateRange
    ? `?since=${dateRange.since}&until=${dateRange.until}`
    : '';
  return apiClient.get<MetaInsights>(`/api/campaigns/${campaignId}/insights${params}`);
}

/**
 * Obtiene los insights de todas las campañas
 */
export async function getAllCampaignsInsights(
  dateRange?: DateRange
): Promise<CampaignData[]> {
  const params = dateRange
    ? `?since=${dateRange.since}&until=${dateRange.until}`
    : '';
  return apiClient.get<CampaignData[]>(`/api/campaigns/insights${params}`);
}

/**
 * Obtiene estadísticas generales del dashboard
 */
export async function getDashboardStats(dateRange?: DateRange): Promise<{
  totalSpend: string;
  totalImpressions: string;
  totalClicks: string;
  averageCTR: string;
  totalROAS: number;
}> {
  const params = dateRange
    ? `?since=${dateRange.since}&until=${dateRange.until}`
    : '';
  return apiClient.get(`/api/dashboard/stats${params}`);
}
