/**
 * The report (PRD FR-15, TRD §12).
 *
 * Three parts, each testable on its own: a snapshot built from stored rows, a PDF renderer that
 * reads only that snapshot, and private storage for the bytes. Nothing here needs the site, the
 * crawler or the database, so a report can be re-rendered from history and must come out the same.
 */

export {
  ALWAYS_TRUE_LIMITATIONS,
  buildReportSnapshot,
  CATEGORY_LABELS,
  listedFindings,
  MAX_LISTED_FINDINGS,
  METHODOLOGY,
  REPORT_TEMPLATE_VERSION,
  SEVERITY_LABELS,
  severityCounts,
  sortFindings,
} from "./snapshot.js";
export type { AiStatus, ReportAudit, ReportFinding, ReportSnapshot, ReportSource } from "./snapshot.js";

export { buildReportOutline, renderReportPdf, sanitizePdfText, wrapText } from "./pdf.js";
export type { OutlineBlock, OutlineStyle, RenderOptions } from "./pdf.js";
