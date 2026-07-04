import { z } from "zod";

export const PositionChangeSchema = z.object({
  model_id: z.string().min(1),
  changed_from: z.string(),
  changed_to: z.string(),
  reason: z.string(),
});
export type PositionChange = z.infer<typeof PositionChangeSchema>;

export const ConfidenceSummarySchema = z.object({
  consensus_strength: z.enum(["high", "medium", "low"]),
  notes: z.string(),
});
export type ConfidenceSummary = z.infer<typeof ConfidenceSummarySchema>;

export const FinalAnswerSchema = z.object({
  final_answer: z.string().min(1),
  strong_consensus: z.array(z.string()),
  qualified_consensus: z.array(z.string()),
  disputed_points: z.array(z.string()),
  rejected_or_unsupported: z.array(z.string()),
  model_position_changes: z.array(PositionChangeSchema),
  confidence_summary: ConfidenceSummarySchema,
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;

// v0.2 planning mode: same shape as FinalAnswerSchema, scoped to one outline
// topic, plus a mandatory one-sentence tldr. The executive_summary in
// PlanDocumentSchema is assembled in code from these tldr fields — never a
// fresh cross-topic model call, which would re-introduce compose acting as a
// judge across topics (see docs/protocol.md 4.1/4.3).
export const SectionAnswerSchema = z.object({
  topic_id: z.string().min(1),
  title: z.string().min(1),
  tldr: z.string().min(1),
  section_answer: z.string().min(1),
  strong_consensus: z.array(z.string()),
  qualified_consensus: z.array(z.string()),
  disputed_points: z.array(z.string()),
  rejected_or_unsupported: z.array(z.string()),
  model_position_changes: z.array(PositionChangeSchema),
  confidence_summary: ConfidenceSummarySchema,
});
export type SectionAnswer = z.infer<typeof SectionAnswerSchema>;

export const PlanDocumentSchema = z.object({
  executive_summary: z.string().min(1),
  sections: z.array(SectionAnswerSchema).min(1),
});
export type PlanDocument = z.infer<typeof PlanDocumentSchema>;
