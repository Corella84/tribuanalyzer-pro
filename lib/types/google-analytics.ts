export interface GA4Property {
  property: string;
  displayName: string;
}

export interface GA4Overview {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  bounceRate: number;
  avgSessionDuration: number;
  pageViews: number;
  engagementRate: number;
  conversions: number;
  revenue: number;
}

export interface GA4TrafficSource {
  source: string;
  medium: string;
  sessions: number;
  users: number;
  conversions: number;
  revenue: number;
}

export interface GA4ReportResponse {
  success: boolean;
  overview: GA4Overview;
  trafficSources: GA4TrafficSource[];
}
