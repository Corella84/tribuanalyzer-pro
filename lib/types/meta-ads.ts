// lib/types/meta-ads.ts

export interface MetaCampaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  objective?: string;
  created_time?: string;
}

export interface MetaInsights {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  actions?: MetaAction[];
  action_values?: MetaActionValue[];
  date_start?: string;
  date_stop?: string;
}

export interface MetaAction {
  action_type: string;
  value: string;
}

export interface MetaActionValue {
  action_type: string;
  value: string;
}

export interface CampaignData {
  id: string;
  name: string;
  status: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  roas: number;
}

export type DatePreset = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'lifetime';

export interface DateRange {
  since: string;  // YYYY-MM-DD
  until: string;  // YYYY-MM-DD
}