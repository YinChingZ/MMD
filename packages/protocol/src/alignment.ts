import type { CandidateClaim } from "./schemas/normalize.js";

export interface AlignmentClaim {
  claim_id: string;
  text: string;
  model_id: string;
  topic_id?: string;
}

export interface PairSupport {
  left_claim_id: string;
  right_claim_id: string;
  support: number;
  cannot_link: boolean;
}

export interface ClusterDecision {
  left: string[];
  right: string[];
  action: "merge" | "reject";
  reason: "complete_link_supported" | "insufficient_support" | "cannot_link";
}

export interface CompleteLinkResult {
  clusters: string[][];
  decisions: ClusterDecision[];
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function clusterKey(cluster: string[]): string {
  return [...cluster].sort().join("\u0001");
}

export function deterministicCompleteLink(params: {
  claimIds: string[];
  pairSupport: PairSupport[];
  minimumSupport: number;
}): CompleteLinkResult {
  if (!Number.isInteger(params.minimumSupport) || params.minimumSupport < 1) {
    throw new Error("minimumSupport must be a positive integer");
  }
  const unique = [...new Set(params.claimIds)].sort();
  if (unique.length !== params.claimIds.length) {
    throw new Error("claimIds must be unique");
  }
  const support = new Map(
    params.pairSupport.map((pair) => [
      pairKey(pair.left_claim_id, pair.right_claim_id),
      pair,
    ])
  );
  let clusters = unique.map((id) => [id]);
  const decisions: ClusterDecision[] = [];

  while (true) {
    const pairs: Array<[number, number]> = [];
    for (let left = 0; left < clusters.length; left += 1) {
      for (let right = left + 1; right < clusters.length; right += 1) {
        pairs.push([left, right]);
      }
    }
    pairs.sort((a, b) => {
      const ak = `${clusterKey(clusters[a[0]])}\u0002${clusterKey(clusters[a[1]])}`;
      const bk = `${clusterKey(clusters[b[0]])}\u0002${clusterKey(clusters[b[1]])}`;
      return ak.localeCompare(bk);
    });

    let merged = false;
    for (const [leftIndex, rightIndex] of pairs) {
      const left = clusters[leftIndex];
      const right = clusters[rightIndex];
      const crossPairs = left.flatMap((leftId) =>
        right.map((rightId) => support.get(pairKey(leftId, rightId)))
      );
      const hasCannotLink = crossPairs.some((pair) => pair?.cannot_link);
      const fullySupported = crossPairs.every(
        (pair) => pair !== undefined && pair.support >= params.minimumSupport
      );
      if (hasCannotLink || !fullySupported) {
        decisions.push({
          left: [...left],
          right: [...right],
          action: "reject",
          reason: hasCannotLink ? "cannot_link" : "insufficient_support",
        });
        continue;
      }
      decisions.push({
        left: [...left],
        right: [...right],
        action: "merge",
        reason: "complete_link_supported",
      });
      const next = clusters.filter(
        (_cluster, index) => index !== leftIndex && index !== rightIndex
      );
      next.push([...left, ...right].sort());
      clusters = next.sort((a, b) => clusterKey(a).localeCompare(clusterKey(b)));
      merged = true;
      break;
    }
    if (!merged) break;
  }

  return { clusters, decisions };
}

export function candidatesFromClusters(params: {
  runId: string;
  topicId?: string;
  claims: AlignmentClaim[];
  clusters: string[][];
}): CandidateClaim[] {
  const byId = new Map(params.claims.map((claim) => [claim.claim_id, claim]));
  const scope = params.topicId ?? "root";
  return [...params.clusters]
    .map((cluster) => [...cluster].sort())
    .sort((a, b) => clusterKey(a).localeCompare(clusterKey(b)))
    .map((sourceIds, index) => {
      const representative = byId.get(sourceIds[0]);
      if (!representative) throw new Error(`unknown claim id: ${sourceIds[0]}`);
      return {
        candidate_id: `${params.runId}::${scope}::candidate::${String(index).padStart(3, "0")}`,
        text: representative.text,
        source_claim_ids: sourceIds,
        topic_id: params.topicId,
        notes: "deterministic complete-link cluster",
      };
    });
}
