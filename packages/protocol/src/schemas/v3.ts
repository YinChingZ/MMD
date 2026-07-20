import { z } from "zod";
import { BallotSchema } from "./vote.js";
import { ConsensusLabel } from "./common.js";

export const GovernanceSchema = z.enum(["centralized", "distributed"]);
export type Governance = z.infer<typeof GovernanceSchema>;

export const AlignmentRelationSchema = z.enum([
  "equivalent",
  "distinct",
  "conflict",
  "uncertain",
]);
export type AlignmentRelation = z.infer<typeof AlignmentRelationSchema>;

export const AlignmentJudgmentSchema = z.object({
  left_claim_id: z.string().min(1),
  right_claim_id: z.string().min(1),
  relation: AlignmentRelationSchema,
  preferred_source_claim_id: z.string().min(1).optional(),
  cannot_link: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});
export type AlignmentJudgment = z.infer<typeof AlignmentJudgmentSchema>;

export const AlignResultSchema = z.object({
  aligner_model_id: z.string().min(1),
  judgments: z.array(AlignmentJudgmentSchema),
});
export type AlignResult = z.infer<typeof AlignResultSchema>;

export const AlignmentPolicySchema = z.object({
  version: z.string().min(1),
  minimum_pair_support: z.number().int().min(1),
});
export type AlignmentPolicy = z.infer<typeof AlignmentPolicySchema>;

export const ExperimentManifestSchema = z.object({
  experiment_id: z.string().min(1),
  protocol_version: z.literal("mmd.v3"),
  alignment_policy: AlignmentPolicySchema.optional(),
});
export type ExperimentManifest = z.infer<typeof ExperimentManifestSchema>;

export const ClassificationBasisSchema = z.object({
  candidate_set_id: z.string().min(1),
  expected_voter_count: z.number().int().positive(),
  ballots: z.array(BallotSchema),
  approve_ratio: z.number().min(0).max(1),
  label: ConsensusLabel,
  partial: z.boolean(),
});
export type ClassificationBasis = z.infer<typeof ClassificationBasisSchema>;

export const GlobalComposeCandidateSchema = z.object({
  topic_id: z.string().min(1),
  candidate_id: z.string().min(1),
  classification: ConsensusLabel,
  text: z.string().min(1),
});
export type GlobalComposeCandidate = z.infer<typeof GlobalComposeCandidateSchema>;

export const PlanningOutputSpanSchema = z.object({
  span_id: z.string().min(1),
  text: z.string().min(1),
  source_candidate_ids: z.array(z.string().min(1)),
  lineage_kind: z.enum(["candidate", "coordinator_synthesis"]),
  derived_from_candidate_ids: z.array(z.string().min(1)).default([]),
});
export type PlanningOutputSpan = z.infer<typeof PlanningOutputSpanSchema>;

export const PlanningOmissionSchema = z.object({
  candidate_id: z.string().min(1),
  reason: z.string().min(1),
});
export type PlanningOmission = z.infer<typeof PlanningOmissionSchema>;

export const PlanningFinalAnswerSchema = z.object({
  final_answer: z.string().min(1),
  spans: z.array(PlanningOutputSpanSchema).min(1),
  omitted_strong_candidate_reasons: z.array(PlanningOmissionSchema),
});
export type PlanningFinalAnswer = z.infer<typeof PlanningFinalAnswerSchema>;

export const TraceArtifactSchema = z.object({
  artifact_id: z.string().min(1),
  kind: z.string().min(1),
  phase: z.string().min(1),
  status: z.enum(["completed", "partial", "failed"]),
  parent_ids: z.array(z.string().min(1)),
  topic_id: z.string().min(1).optional(),
  candidate_set_id: z.string().min(1).optional(),
  payload: z.unknown(),
});
export type TraceArtifact = z.infer<typeof TraceArtifactSchema>;

export const TraceCallSchema = z.object({
  call_id: z.string().min(1),
  phase: z.string().min(1),
  model_id: z.string().min(1),
  role: z.enum(["panel", "coordinator", "host"]),
  status: z.enum(["completed", "failed", "timeout"]),
  attempt: z.number().int().min(0),
  topic_id: z.string().min(1).optional(),
  usage: z.object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
    cost_usd: z.number().min(0),
    usage_unavailable_count: z.number().int().min(0),
  }).optional(),
  cost_usd: z.number().min(0).optional(),
  latency_ms: z.number().min(0).optional(),
  error_code: z.string().min(1).optional(),
});
export type TraceCall = z.infer<typeof TraceCallSchema>;

export const TraceFailureSchema = z.object({
  phase: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  recoverable: z.boolean(),
  topic_id: z.string().min(1).optional(),
  model_id: z.string().min(1).optional(),
});
export type TraceFailure = z.infer<typeof TraceFailureSchema>;

export const MmdTraceV3Schema = z.object({
  trace_version: z.literal("mmd.trace.v3"),
  protocol_version: z.literal("mmd.v3"),
  run_id: z.string().min(1),
  mode: z.enum(["quick", "standard", "planning"]),
  governance: GovernanceSchema,
  status: z.enum(["running", "completed", "partial", "failed"]),
  versions: z.object({
    normalization: z.string().min(1),
    alignment: z.string().min(1),
    decision_rule: z.string().min(1),
    renderer: z.string().min(1),
  }),
  artifacts: z.array(TraceArtifactSchema),
  candidate_sets: z.array(z.object({
    candidate_set_id: z.string().min(1),
    governance: GovernanceSchema,
    topic_id: z.string().min(1).optional(),
    candidate_ids: z.array(z.string().min(1)),
    classification_basis: z.record(ClassificationBasisSchema),
    alignment: z.unknown().optional(),
  })),
  calls: z.array(TraceCallSchema),
  quorum: z.array(z.object({
    phase: z.string().min(1),
    topic_id: z.string().min(1).optional(),
    met: z.boolean(),
    required: z.number().int().min(1),
    respondent_count: z.number().int().min(0),
    expected_count: z.number().int().min(1),
    partial: z.boolean(),
  })),
  failures: z.array(TraceFailureSchema),
  usage: z.object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
    cost_usd: z.number().min(0),
    usage_unavailable_count: z.number().int().min(0),
  }),
  extensions: z.record(z.unknown()).default({}),
});
export type MmdTraceV3 = z.infer<typeof MmdTraceV3Schema>;
