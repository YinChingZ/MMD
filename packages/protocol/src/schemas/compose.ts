import { z } from "zod";

export const PositionChangeSchema = z.object({
  model_id: z.string().min(1),
  changed_from: z.string(),
  changed_to: z.string(),
  reason: z.string(),
});
export type PositionChange = z.infer<typeof PositionChangeSchema>;

export const FinalAnswerSchema = z.object({
  final_answer: z.string().min(1),
  strong_consensus: z.array(z.string()),
  qualified_consensus: z.array(z.string()),
  disputed_points: z.array(z.string()),
  rejected_or_unsupported: z.array(z.string()),
  model_position_changes: z.array(PositionChangeSchema),
  confidence_summary: z.object({
    consensus_strength: z.enum(["high", "medium", "low"]),
    notes: z.string(),
  }),
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;
