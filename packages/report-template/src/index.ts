/**
 * Report template contract (TRD §12). The renderer takes a stored audit snapshot and
 * returns HTML for the PDF step; it never reads the live site and never invents data.
 */

export const REPORT_TEMPLATE_VERSION = 0;

export interface ReportBranding {
  agencyName?: string;
  logoUrl?: string;
}

export interface ReportSnapshotMeta {
  domain: string;
  createdAt: string;
  overallScore: number | null;
  branding?: ReportBranding;
}
