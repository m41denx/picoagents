import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { Plan } from "@/core/agents/planner.ts";
import { PlanRejectedError, runPicoagentSession } from "@/core/session.ts";
import {
  RunDashboard,
  formatDurationSec,
  type AgentUiRow,
} from "@/tui/run-dashboard.tsx";
import { spinnerAt } from "@/tui/spinner.ts";

function PlanScreen({
  plan,
  planningDurationSec,
  onApprove,
  onReject,
}: {
  plan: Plan;
  planningDurationSec?: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  useInput((input, key) => {
    if (input === "y" || input === "Y") onApprove();
    if (input === "n" || input === "N") onReject();
    if (input === "q" || key.escape) onReject();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="row" flexWrap="wrap">
        <Text color="green">✔ </Text>
        <Text>Planning</Text>
        {planningDurationSec ? (
          <>
            <Text dimColor> • </Text>
            <Text dimColor>{planningDurationSec}</Text>
          </>
        ) : null}
      </Box>
      <Text bold color="cyan">
        Review plan — y approve · n reject · q quit
      </Text>
      <Text bold>{plan.title}</Text>
      {plan.phases.map((ph) => (
        <Box key={ph.name} flexDirection="column" marginTop={1}>
          <Text bold>{ph.name}</Text>
          {ph.tasks.map((t) => (
            <Text key={t.id}>
              {"  "}- [{t.id}] {t.title}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function SessionApp({
  goal,
  projectRoot,
  workspaceRoot,
  oneshot,
  onFinished,
  onAborted,
  onError,
}: {
  goal: string;
  projectRoot: string;
  workspaceRoot: string;
  oneshot: boolean;
  onFinished: (summary: string) => void;
  /** Plan declined — exit without treating as an error */
  onAborted?: () => void;
  onError: (err: unknown) => void;
}) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<"loading" | "plan" | "run">(() =>
    oneshot ? "run" : "loading",
  );
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planReady, setPlanReady] = useState(oneshot);
  const [agents, setAgents] = useState<AgentUiRow[]>([]);
  const [summary, setSummary] = useState("");
  const [tick, setTick] = useState(0);
  const [orch, setOrch] = useState({
    running: false,
    multiStep: false,
    finished: false,
  });
  const [planningStartMs] = useState<number | null>(() =>
    oneshot ? null : Date.now(),
  );
  const [planningEndMs, setPlanningEndMs] = useState<number | null>(null);
  const [orchestratorStartMs, setOrchestratorStartMs] = useState<number | null>(
    null,
  );
  const [orchestratorEndMs, setOrchestratorEndMs] = useState<number | null>(
    null,
  );
  const approveRef = useRef<((ok: boolean) => void) | null>(null);
  const displayCounter = useRef(0);
  const agentByRun = useRef(new Map<string, number>());
  const orchestratorEverStarted = useRef(false);
  const onFinishedRef = useRef(onFinished);
  const onErrorRef = useRef(onError);
  onFinishedRef.current = onFinished;
  onErrorRef.current = onError;

  /** Keep spinner alive until orchestrator run completes (including pre-start wait). */
  const busy = phase === "loading" || !orch.finished;

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await runPicoagentSession({
          projectRoot,
          workspaceRoot,
          goal,
          skipPlanner: oneshot,
          callbacks: {
            onSessionLog: () => {},
            onPlanReady: async (p) => {
              setPlanningEndMs(Date.now());
              setPlan(p);
              setPlanReady(true);
              setPhase("plan");
              await new Promise<void>((r) => queueMicrotask(() => r()));
              return await new Promise<boolean>((resolve) => {
                approveRef.current = resolve;
              });
            },
            onOrchestratorStart: () => {
              orchestratorEverStarted.current = true;
              setOrchestratorStartMs(Date.now());
              setPhase("run");
              setOrch((o) => ({ ...o, running: true, finished: false }));
            },
            onOrchestratorStepFinish: (info) => {
              if (info.stepNumber >= 1 && info.hadToolCalls) {
                setOrch((o) => ({ ...o, multiStep: true }));
              }
            },
            onOrchestratorLog: () => {},
            onSubagentStarted: (runId, agentKey, task) => {
              setPhase("run");
              let idx = agentByRun.current.get(runId);
              if (idx === undefined) {
                displayCounter.current += 1;
                idx = displayCounter.current;
                agentByRun.current.set(runId, idx);
              }
              setAgents((prev) => {
                const i = prev.findIndex((a) => a.runId === runId);
                const taskLine = task.replace(/\s+/g, " ").trim().slice(0, 120);
                const row: AgentUiRow = {
                  runId,
                  displayIndex: idx!,
                  agentKey,
                  status: "running",
                  task,
                  latest: taskLine || "Starting…",
                  startedAtMs: Date.now(),
                };
                if (i >= 0) {
                  const next = [...prev];
                  next[i] = { ...next[i]!, ...row };
                  return next;
                }
                return [...prev, row];
              });
            },
            onSubagentFinished: (runId, agentKey, ok, text) => {
              const line = text.replace(/\s+/g, " ").trim().slice(0, 200);
              setAgents((prev) =>
                prev.map((a) => {
                  if (a.runId !== runId) return a;
                  const end = Date.now();
                  const durationMs =
                    a.startedAtMs != null ? end - a.startedAtMs : undefined;
                  return {
                    ...a,
                    agentKey,
                    status: ok ? "done" : "error",
                    resultLine: line || (ok ? "(no text)" : "(failed)"),
                    latest: ok ? "Done" : "Error",
                    durationMs,
                  };
                }),
              );
            },
          },
        });
        if (cancelled) return;
        setSummary(result.orchestratorSummary);
        setOrchestratorEndMs(Date.now());
        setOrch({ running: false, multiStep: false, finished: true });
        setTimeout(() => {
          if (cancelled) return;
          onFinishedRef.current(result.orchestratorSummary);
          exit();
        }, 120);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof PlanRejectedError) {
          onAborted?.();
          exit();
          return;
        }
        if (orchestratorEverStarted.current) {
          setOrchestratorEndMs(Date.now());
        }
        onErrorRef.current(e);
        exit();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goal, projectRoot, workspaceRoot, oneshot, exit]);

  const planReviewDuration =
    planningStartMs != null && planningEndMs != null
      ? formatDurationSec(planningEndMs - planningStartMs)
      : null;

  if (phase === "loading" && !oneshot) {
    return (
      <Box padding={1} flexDirection="row" flexWrap="wrap">
        <Text color="cyan">{spinnerAt(tick)} </Text>
        <Text>Planning…</Text>
        {planningStartMs != null && planningEndMs == null ? (
          <>
            <Text dimColor> • </Text>
            <Text dimColor>
              {formatDurationSec(Date.now() - planningStartMs)}
            </Text>
          </>
        ) : null}
      </Box>
    );
  }

  if (phase === "plan" && plan) {
    return (
      <PlanScreen
        plan={plan}
        planningDurationSec={planReviewDuration}
        onApprove={() => {
          setPhase("run");
          approveRef.current?.(true);
          approveRef.current = null;
        }}
        onReject={() => {
          approveRef.current?.(false);
          approveRef.current = null;
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <RunDashboard
        goal={goal}
        tick={tick}
        planningSkipped={oneshot}
        planReady={planReady}
        planningTimer={{
          startMs: planningStartMs,
          endMs: planningEndMs,
        }}
        orchestratorTimer={{
          startMs: orchestratorStartMs,
          endMs: orchestratorEndMs,
        }}
        orchestrator={orch}
        agents={agents}
        finalSummary={orch.finished ? summary : undefined}
      />
    </Box>
  );
}

export async function runTuiSession(
  goal: string,
  projectRoot: string,
  workspaceRoot: string,
  opts?: { oneshot?: boolean },
): Promise<string | null> {
  const { render } = await import("ink");
  return await new Promise<string | null>((resolve, reject) => {
    const { waitUntilExit } = render(
      <SessionApp
        goal={goal}
        projectRoot={projectRoot}
        workspaceRoot={workspaceRoot}
        oneshot={opts?.oneshot ?? false}
        onFinished={(s) => resolve(s)}
        onAborted={() => resolve(null)}
        onError={(e) => reject(e)}
      />,
    );
    void waitUntilExit().catch(reject);
  });
}
