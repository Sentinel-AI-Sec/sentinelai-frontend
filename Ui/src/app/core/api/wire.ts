/**
 * The read API's wire shapes (SEC-40), transcribed exactly.
 *
 * Property names are snake_case because that is what the backend sends — the DTOs carry
 * explicit `[JsonPropertyName]` attributes, so these are not a naming style choice, they are
 * the contract. There is deliberately no camelCase mapping layer: a mapper is a second place
 * for the shape to live, and the failure it produces is a silently `undefined` field that
 * renders as an empty cell rather than an error. The templates read the wire names directly.
 *
 * Source of truth: `SentinelAI.Application/Features/Scan/Queries/Read/ReadModels.cs`.
 */

/** Weakest to strongest. A chain inherits the weakest tier on its path (AID-01 §3.3). */
export type Confidence = 'unresolved' | 'inferred' | 'certain';

/** Which of the three layers a node or finding belongs to. */
export type Layer = 'code' | 'dep' | 'infra';

/** Canonical node types, spelled as the API writes them. */
export type NodeType = 'pkg' | 'code' | 'image' | 'task' | 'role' | 'resource';

/** Which join produced an edge. */
export type Seam = 'infra-spine' | 'dep-code' | 'code-infra' | 'role-resource';

/**
 * Where a chain got to in adjudication, lower-cased by `Wire.Of(ChainStatus)`.
 *
 * A union rather than `string`, because the screen makes a decision on this value: `rejected`
 * chains are demoted below the rest. Typed as `string` it compiled happily against `'refuted'`
 * — a word that reads right, appears nowhere in the backend, and would have quietly promoted
 * every chain Blue threw out back up beside the real ones.
 */
export type ChainStatus = 'candidate' | 'asserted' | 'validated' | 'rejected';

/**
 * GET /v1/scans/{id} — and note it does not look like its neighbours.
 *
 * This one predates SEC-40 and was never converted: `ScanJobResponse` carries no
 * `[JsonPropertyName]` attributes, so it serializes with the default camelCase policy, and it
 * is returned inside the `Response` envelope rather than unwrapped. Its enums are numbers,
 * because the API registers no `JsonStringEnumConverter` — unlike the SEC-40 views, which spell
 * their enums out through `Wire.Of(...)` before they ever reach the serializer.
 *
 * Three differences from every other type in this file, none of them guessable. Transcribed
 * from `ScanJobResponse.cs` and `DependencyInjection.cs` rather than assumed to match.
 */
export interface ScanJobResponse {
  scanJobId: string;
  /** Numeric `ScanStatus`. Use {@link ScanStatusName} to read it. */
  status: number;
  /** Numeric `ScanStage`. Use {@link ScanStageName} to read it. */
  stage: number;
  corpusVersion: string;
  bundlePurged: boolean;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** The `Response` wrapper this endpoint — unlike the SEC-40 reads — does not unwrap. */
export interface ResponseEnvelope<T> {
  statusCode: number;
  isSuccess: boolean;
  data: T;
  message: string;
}

/** `ScanStatus`, in declaration order. */
export const ScanStatusName = ['queued', 'running', 'completed', 'failed'] as const;

/** `ScanStage`, in declaration order. */
export const ScanStageName = [
  'received',
  'normalize',
  'graph',
  'retrieve',
  'debate',
  'report',
] as const;

/** GET /v1/scans/{id}/bundle — provenance. Survives the bundle's own purge. */
export interface BundleProvenance {
  scan_job_id: string;
  runner_secret_scan: string;
  ingress_redaction_applied: boolean;
  artifact_manifest: string;
  scanner_versions: string;
  sha256: string;
  size_bytes: number;
  received_at: string;
  bundle_purged: boolean;
}

/** GET /v1/scans/{id}/findings */
export interface Finding {
  id: string;
  source_tool: string;
  layer: Layer;
  severity: number;
  cwe_id: string | null;
  cve_id: string | null;
  node_ref: string;
  message: string;
  redacted: boolean;
}

export interface GraphNode {
  node_key: string;
  type: NodeType;
  layer: Layer;
  is_hot: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
  seam: Seam;
  confidence: Confidence;
  oriented_attack_dir: boolean;
}

/** GET /v1/scans/{id}/graph — never paginated; a page of a graph cannot be drawn. */
export interface ResourceGraph {
  scan_job_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** One step along a candidate chain. */
export interface ChainHop {
  order: number;
  technique_id: string;
  blue_validated: boolean;
  /** Null on the seed hop, which arrived from nowhere. */
  edge_confidence: Confidence | null;
  finding_id: string | null;
  node_key: string | null;
}

/** GET /v1/scans/{id}/chains, and embedded in a report. */
export interface Chain {
  id: string;
  priority: number;
  hop_count: number;
  status: ChainStatus;
  min_confidence: Confidence;
  hops: ChainHop[];
}

/** What the corpus was asked, and what it answered with. */
export interface Citation {
  knowledge_id: string;
  source: string;
  collection: string;
}

export interface ReportCost {
  currency: string;
  total: number;
  model_calls: number;
  rated: boolean;
}

/** GET /v1/reports/{id} */
export interface Report {
  report_id: string;
  scan_job_id: string;
  /** Always `draft_audit`. The screen must show this, not bury it. */
  framing: string;
  summary: string;
  corpus_version: string;
  created_at: string;
  retained: boolean;
  chains: Chain[];
  citations: Citation[];
  cost: ReportCost;
}

/**
 * A cursor page, as `CursorPage<T>` serializes it.
 *
 * `limit` is the clamped page size the server actually applied, not the one that was asked
 * for — it caps at 200 — so it is what a "load more" control should page by.
 */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  limit: number;
}

/** RFC 7807, which every read endpoint uses for failures. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
}
