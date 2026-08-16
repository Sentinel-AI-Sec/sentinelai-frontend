import { Chain, Finding, Report } from './wire';

/**
 * The reference fixture's audit, in the exact wire shapes the read API returns.
 *
 * Not lorem ipsum, and that matters. This is the golden chain SEC-04 was authored around and
 * the whole product is built to reconstruct — a dependency CVE reaching a customer-data bucket
 * through four joins. Demoing against it means the screen is exercised by the case it exists
 * to display, including the two cases a happy-path mock would quietly skip: a chain whose
 * weakest join is `inferred`, and one that could not be resolved at all.
 *
 * Node keys and `type` spellings follow the API design doc §5.4.
 */

/** The flagship: package → code → image → task → role → bucket. */
const flagship: Chain = {
  id: 'chain-flagship',
  priority: 1,
  hop_count: 4,
  status: 'validated',
  // The image-name join is a naming convention, not proof — so the whole chain inherits it.
  min_confidence: 'inferred',
  hops: [
    {
      order: 1,
      technique_id: 'T1195.001',
      blue_validated: true,
      edge_confidence: null, // seed hop: it arrived from nowhere
      finding_id: 'finding-dep-01',
      node_key: 'pkg:newtonsoft.json:12.0.1',
    },
    {
      order: 2,
      technique_id: 'T1190',
      blue_validated: true,
      edge_confidence: 'certain',
      finding_id: 'finding-code-01',
      node_key: 'code:orderscontroller',
    },
    {
      order: 3,
      technique_id: 'T1610',
      blue_validated: true,
      edge_confidence: 'inferred',
      finding_id: null,
      node_key: 'task:order',
    },
    {
      order: 4,
      technique_id: 'T1078.004',
      blue_validated: true,
      edge_confidence: 'certain',
      finding_id: 'finding-infra-01',
      node_key: 'iam_role:order_task_role',
    },
    {
      order: 5,
      technique_id: 'T1530',
      blue_validated: true,
      edge_confidence: 'certain',
      finding_id: 'finding-infra-02',
      node_key: 's3:customer-data',
    },
  ],
};

/** The fixture's deliberate unresolved seam: an image name matching no Dockerfile. */
const unresolved: Chain = {
  id: 'chain-legacy-worker',
  priority: 2,
  hop_count: 2,
  status: 'candidate',
  min_confidence: 'unresolved',
  hops: [
    {
      order: 1,
      technique_id: 'T1190',
      blue_validated: false,
      edge_confidence: null,
      finding_id: 'finding-code-03',
      node_key: 'code:reportscontroller',
    },
    {
      order: 2,
      technique_id: 'T1610',
      blue_validated: false,
      edge_confidence: 'unresolved',
      finding_id: null,
      node_key: 'task:legacy_worker',
    },
    {
      order: 3,
      technique_id: 'T1078.004',
      blue_validated: false,
      edge_confidence: 'certain',
      finding_id: null,
      node_key: 'iam_role:legacy_worker_role',
    },
  ],
};

/** A chain Blue broke: the bucket it reaches holds build output, not customer data. */
const rejected: Chain = {
  id: 'chain-build-artifacts',
  priority: 3,
  hop_count: 2,
  status: 'rejected',
  min_confidence: 'certain',
  hops: [
    {
      order: 1,
      technique_id: 'T1078.004',
      blue_validated: false,
      edge_confidence: null,
      finding_id: 'finding-infra-05',
      node_key: 'iam_role:legacy_worker_role',
    },
    {
      order: 2,
      technique_id: 'T1530',
      blue_validated: false,
      edge_confidence: 'certain',
      finding_id: null,
      node_key: 's3:build-artifacts',
    },
  ],
};

export const demoFindings: Finding[] = [
  {
    id: 'finding-dep-01',
    source_tool: 'osv',
    layer: 'dep',
    severity: 4,
    cwe_id: 'CWE-502',
    cve_id: 'CVE-2024-21907',
    node_ref: 'pkg:newtonsoft.json:12.0.1',
    message: 'Newtonsoft.Json 12.0.1 is affected by a deserialization-of-untrusted-data issue.',
    redacted: false,
  },
  {
    id: 'finding-code-01',
    source_tool: 'roslyn',
    layer: 'code',
    severity: 4,
    cwe_id: 'CWE-502',
    cve_id: null,
    node_ref: 'code:orderscontroller',
    message:
      'SCS0028: Unsafe deserialization. TypeNameHandling.All lets an attacker instantiate ' +
      'arbitrary types from an untrusted payload.',
    redacted: false,
  },
  {
    id: 'finding-infra-01',
    source_tool: 'checkov',
    layer: 'infra',
    severity: 4,
    cwe_id: 'CWE-284',
    cve_id: null,
    node_ref: 'iam_role:order_task_role',
    message: 'CKV_AWS_286: IAM policy grants s3:* on a wildcard resource.',
    redacted: false,
  },
  {
    id: 'finding-infra-02',
    source_tool: 'trivy',
    layer: 'infra',
    severity: 3,
    cwe_id: 'CWE-311',
    cve_id: null,
    node_ref: 's3:customer-data',
    message: 'AVD-AWS-0088: S3 bucket does not have server-side encryption enabled.',
    redacted: false,
  },
  {
    id: 'finding-infra-07',
    source_tool: 'ingress-gate',
    layer: 'infra',
    severity: 4,
    cwe_id: 'CWE-798',
    cve_id: null,
    node_ref: 'resource:dockerfile',
    message:
      'Hardcoded credential in Dockerfile:22 (rule: assigned-secret). The value was removed at ' +
      'ingress and never reached a model, but it is still in the repository and should be ' +
      'rotated and moved to a secret store.',
    redacted: true,
  },
  {
    id: 'finding-code-03',
    source_tool: 'roslyn',
    layer: 'code',
    severity: 3,
    cwe_id: 'CWE-79',
    cve_id: null,
    node_ref: 'code:reportscontroller',
    message: 'SCS0029: Potential cross-site scripting in a response written from user input.',
    redacted: false,
  },
];

export const demoReport: Report = {
  report_id: 'demo-report',
  scan_job_id: 'demo-scan',
  framing: 'draft_audit',
  summary:
    'One chain reaches customer data: a known-vulnerable JSON library is deserialized unsafely ' +
    'in OrdersController, and the task running that code assumes a role with an s3:* wildcard ' +
    'over the customer-data bucket. The code-to-infrastructure join rests on an image-name ' +
    'convention rather than a digest, so the chain is reported as inferred rather than ' +
    'certain. A second path could not be resolved past its image join, and a third was ' +
    'refuted: the bucket it reaches holds build output, not customer data.',
  corpus_version: '2026-07-15',
  created_at: '2026-08-16T09:14:22Z',
  retained: true,
  chains: [flagship, unresolved, rejected],
  citations: [
    { knowledge_id: 'T1530', source: 'ATT&CK', collection: 'offense' },
    { knowledge_id: 'CAPEC-586', source: 'CAPEC', collection: 'offense' },
    { knowledge_id: 'CWE-502', source: 'CWE', collection: 'offense' },
    { knowledge_id: 'A08:2021', source: 'OWASP', collection: 'defense' },
  ],
  cost: { currency: 'USD', total: 0.42, model_calls: 11, rated: true },
};
