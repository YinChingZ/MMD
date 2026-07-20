from __future__ import annotations

from dataclasses import dataclass

from .schemas import CandidateClaim


@dataclass(frozen=True)
class PairSupport:
    left_claim_id: str
    right_claim_id: str
    support: int
    cannot_link: bool


def _pair_key(left: str, right: str) -> tuple[str, str]:
    return tuple(sorted((left, right)))  # type: ignore[return-value]


def deterministic_complete_link(
    claim_ids: list[str], pair_support: list[PairSupport], minimum_support: int
) -> tuple[list[list[str]], list[dict[str, object]]]:
    if minimum_support < 1:
        raise ValueError("minimum_support must be positive")
    if len(set(claim_ids)) != len(claim_ids):
        raise ValueError("claim_ids must be unique")
    support = {
        _pair_key(pair.left_claim_id, pair.right_claim_id): pair
        for pair in pair_support
    }
    clusters = [[claim_id] for claim_id in sorted(claim_ids)]
    decisions: list[dict[str, object]] = []
    while True:
        merged = False
        cluster_pairs = [
            (left_index, right_index)
            for left_index in range(len(clusters))
            for right_index in range(left_index + 1, len(clusters))
        ]
        cluster_pairs.sort(key=lambda item: (clusters[item[0]], clusters[item[1]]))
        for left_index, right_index in cluster_pairs:
            left = clusters[left_index]
            right = clusters[right_index]
            cross = [support.get(_pair_key(a, b)) for a in left for b in right]
            cannot_link = any(pair is not None and pair.cannot_link for pair in cross)
            fully_supported = all(
                pair is not None and pair.support >= minimum_support for pair in cross
            )
            if cannot_link or not fully_supported:
                decisions.append(
                    {
                        "left": list(left),
                        "right": list(right),
                        "action": "reject",
                        "reason": "cannot_link" if cannot_link else "insufficient_support",
                    }
                )
                continue
            decisions.append(
                {
                    "left": list(left),
                    "right": list(right),
                    "action": "merge",
                    "reason": "complete_link_supported",
                }
            )
            clusters = [
                cluster
                for index, cluster in enumerate(clusters)
                if index not in (left_index, right_index)
            ]
            clusters.append(sorted([*left, *right]))
            clusters.sort()
            merged = True
            break
        if not merged:
            return clusters, decisions


def candidates_from_clusters(
    *, run_id: str, topic_id: str | None, claims: list[object], clusters: list[list[str]]
) -> list[CandidateClaim]:
    by_id = {getattr(claim, "claim_id"): claim for claim in claims}
    scope = topic_id or "root"
    candidates: list[CandidateClaim] = []
    for index, source_ids in enumerate(sorted([sorted(cluster) for cluster in clusters])):
        representative = by_id[source_ids[0]]
        candidates.append(
            CandidateClaim(
                candidate_id=f"{run_id}::{scope}::candidate::{index:03d}",
                text=getattr(representative, "text"),
                source_claim_ids=source_ids,
                topic_id=topic_id,
                notes="deterministic complete-link cluster",
            )
        )
    return candidates
