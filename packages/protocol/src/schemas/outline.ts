import { z } from "zod";

// v0.2 planning mode: a bounded topic list decided once, up front, by a
// single coordinator call — see docs/protocol.md for why this doesn't need
// the same multi-model treatment as claim-level normalize (no claim/truth
// content exists yet at this point, so there's nothing for a single model to
// silently suppress; a bad split is a coverage gap, not a dissent-erasure
// risk, and it's recoverable in per-topic Propose).
export const TopicSchema = z.object({
  topic_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});
export type Topic = z.infer<typeof TopicSchema>;

export const OutlineResultSchema = z.object({
  topics: z.array(TopicSchema).min(1).max(8),
});
export type OutlineResult = z.infer<typeof OutlineResultSchema>;
