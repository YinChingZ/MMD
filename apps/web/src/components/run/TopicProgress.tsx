import type { Phase } from "@mmd/protocol";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import type { PlanningProgress, PhaseStatus } from "../../lib/progress";
import { ROOT_COMPOSE_KEY } from "../../lib/run-events";
import { Badge } from "../ui/badge";
import { ActivityStream } from "./ActivityStream";
import { StreamingAnswer } from "./StreamingAnswer";

const TOPIC_LEDGER_PHASES: Phase[] = [
  "propose",
  "critique",
  "revise",
  "normalize",
  "vote",
];

function MiniPhaseDots({
  statusFor,
  phases = TOPIC_LEDGER_PHASES,
}: {
  statusFor: (phase: Phase) => PhaseStatus;
  phases?: Phase[];
}) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {phases.map((phase) => {
        const status = statusFor(phase);
        return (
          <span
            key={phase}
            title={messages.run.phases[phase]}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === "pending" && "bg-border",
              status === "in_progress" && "mmd-pulse bg-accent",
              status === "done" && "bg-consensus-strong",
              status === "failed" && "bg-danger",
            )}
          />
        );
      })}
    </span>
  );
}

/** 规划模式右栏摘要：拆题状态 + 各主题一行迷你进度。 */
export function PlanningSummary({ progress }: { progress: PlanningProgress }) {
  const topics = [...progress.topics.entries()];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">
          {messages.run.phases.outline}
        </span>
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            progress.outline === "pending" && "bg-border",
            progress.outline === "in_progress" && "mmd-pulse bg-accent",
            progress.outline === "done" && "bg-consensus-strong",
            progress.outline === "failed" && "bg-danger",
          )}
          aria-hidden
        />
      </div>
      <ul className="flex flex-col gap-2">
        {topics.map(([topicId, topic]) => (
          <li key={topicId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-ink-muted">
              {topic.title ?? topicId}
            </span>
            <MiniPhaseDots statusFor={(p) => topic.phases[p] ?? "pending"} />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-medium text-ink">
          {messages.run.globalCompose}
        </span>
        <Badge
          tone={
            progress.globalCompose === "done"
              ? "strong"
              : progress.globalCompose === "failed"
                ? "rejected"
                : progress.globalCompose === "in_progress"
                  ? "accent"
                  : "neutral"
          }
        >
          {messages.run.phaseStatus[progress.globalCompose]}
        </Badge>
      </div>
    </div>
  );
}

/** Planning v3: per-topic five-stage ledgers plus one root GlobalCompose stream. */
export function TopicProgress({
  progress,
  composeText,
}: {
  progress: PlanningProgress;
  /** v3 uses the root key for the one authoritative GlobalCompose stream. */
  composeText?: Record<string, string>;
}) {
  const topics = [...progress.topics.entries()];
  const done = topics.filter(([, t]) =>
    TOPIC_LEDGER_PHASES.every((phase) => t.phases[phase] === "done"),
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">
          {messages.run.topicsTitle}
        </h2>
        {topics.length > 0 && (
          <span className="text-xs text-ink-faint">
            {done}/{topics.length}
          </span>
        )}
      </div>

      {topics.length === 0 && (
        <p className="text-sm text-ink-faint">
          {messages.run.phases.outline}…
        </p>
      )}

      {topics.map(([topicId, topic]) => {
        const hasLegacyCompose = topic.phases.compose !== undefined;
        const visiblePhases = hasLegacyCompose
          ? [...TOPIC_LEDGER_PHASES, "compose" as Phase]
          : TOPIC_LEDGER_PHASES;
        const activePhase = visiblePhases.find(
          (p) => topic.phases[p] === "in_progress",
        );
        return (
          <div
            key={topicId}
            className="mmd-enter rounded-lg border border-border bg-surface p-4 shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="min-w-0 truncate text-sm font-medium text-ink">
                {topic.title ?? topicId}
              </h3>
              <div className="flex shrink-0 items-center gap-2">
                {topic.failed ? (
                  <Badge tone="rejected">{messages.run.statusFailed}</Badge>
                ) : activePhase ? (
                  <Badge tone="accent">
                    {messages.run.phases[activePhase]}
                  </Badge>
                ) : null}
                <MiniPhaseDots
                  phases={visiblePhases}
                  statusFor={(p) => topic.phases[p] ?? "pending"}
                />
              </div>
            </div>
            {topic.failed && topic.error && (
              <p className="mt-2 text-xs text-danger">{topic.error}</p>
            )}
            <div className="mt-2">
              <ActivityStream
                itemProgress={topic.itemProgress}
                phases={topic.phases}
                phaseOrder={visiblePhases}
              />
            </div>
            {topic.phases.compose === "in_progress" && (
              <div className="mt-2">
                <StreamingAnswer
                  text={composeText?.[topicId] ?? ""}
                  title={topic.title ?? messages.run.composing}
                />
              </div>
            )}
          </div>
        );
      })}

      {topics.length > 0 && (
        <section className="rounded-lg border border-accent/30 bg-accent-muted/30 p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {messages.run.globalCompose}
              </h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                {messages.run.globalComposeHint}
              </p>
            </div>
            <Badge
              tone={
                progress.globalCompose === "done"
                  ? "strong"
                  : progress.globalCompose === "failed"
                    ? "rejected"
                    : progress.globalCompose === "in_progress"
                      ? "accent"
                      : "neutral"
              }
            >
              {messages.run.phaseStatus[progress.globalCompose]}
            </Badge>
          </div>
          {(progress.globalCompose === "in_progress" ||
            Boolean(composeText?.[ROOT_COMPOSE_KEY])) && (
            <div className="mt-3">
              <StreamingAnswer
                text={composeText?.[ROOT_COMPOSE_KEY] ?? ""}
                title={messages.run.composing}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
