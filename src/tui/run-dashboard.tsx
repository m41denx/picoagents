import React from "react";
import { Box, Text } from "ink";
import { spinnerAt } from "./spinner.ts";

export type AgentUiRow = {
  runId: string;
  displayIndex: number;
  agentKey: string;
  status: "running" | "done" | "error";
  task: string;
  perspective?: string;
  /** Short status line while running */
  latest: string;
  /** Final one-liner when done/error */
  resultLine?: string;
  /** Wall-clock start (ms) for this run */
  startedAtMs?: number;
  /** Set when the run ends — total wall time for this run */
  durationMs?: number;
};

export type OrchestratorUiState = {
  running: boolean;
  /** Second+ tool loop step — show warning-style banner */
  multiStep: boolean;
  /** After orchestrator await */
  finished: boolean;
};

function typeColor(agentKey: string): "magenta" | "cyan" | "yellow" | "blue" {
  const h =
    [...agentKey].reduce((a, c) => a + c.charCodeAt(0), 0) %
    4;
  return (["magenta", "cyan", "yellow", "blue"] as const)[h]!;
}

function oneLine(s: string, max = 64): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function formatDurationSec(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Elapsed (running) or final duration (finished), for header `• 38.3s`. */
function agentDurationLabel(a: AgentUiRow): string | null {
  if (a.status === "running" && a.startedAtMs != null) {
    return formatDurationSec(Date.now() - a.startedAtMs);
  }
  if (a.durationMs != null) {
    return formatDurationSec(a.durationMs);
  }
  return null;
}

export function RunDashboard({
  goal,
  tick,
  planningSkipped,
  planReady,
  orchestrator,
  agents,
  finalSummary,
}: {
  goal: string;
  tick: number;
  planningSkipped: boolean;
  planReady: boolean;
  orchestrator: OrchestratorUiState;
  agents: AgentUiRow[];
  finalSummary?: string;
}) {
  const spin = spinnerAt(tick);
  const dense = agents.length > 4;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text dimColor>Prompt: </Text>
        <Text>{oneLine(goal, 72)}</Text>
      </Box>

      {!dense ? (
        <Box flexDirection="row" marginBottom={1} flexWrap="wrap">
          <Text color="green">✔ </Text>
          <Text>
            Planning
            {planningSkipped ? (
              <Text dimColor> (skipped)</Text>
            ) : planReady ? null : (
              <Text dimColor> …</Text>
            )}
          </Text>
          <Text> </Text>
          <Text
            color={
              orchestrator.finished
                ? "green"
                : orchestrator.multiStep
                  ? "yellow"
                  : orchestrator.running
                    ? "cyan"
                    : "gray"
            }
          >
            {orchestrator.finished ? "✔ " : orchestrator.running ? `${spin} ` : "  "}
          </Text>
          <Text bold>Orchestrator</Text>
          <Text dimColor> — </Text>
          {orchestrator.finished ? (
            <Text color="green">all agents complete</Text>
          ) : orchestrator.multiStep ? (
            <Text color="yellow">agents disagree, retrying…</Text>
          ) : orchestrator.running ? (
            <Text color="cyan">working…</Text>
          ) : (
            <Text dimColor>…</Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="row" marginBottom={1} flexWrap="wrap">
          <Text color="green">✔ Planning</Text>
          {planningSkipped ? (
            <Text dimColor> (skipped)</Text>
          ) : null}
          <Text> </Text>
          <Text
            color={
              orchestrator.finished
                ? "green"
                : orchestrator.multiStep
                  ? "yellow"
                  : "cyan"
            }
          >
            {orchestrator.finished ? "✔ " : `${spin} `}
          </Text>
          <Text bold>Orchestrator </Text>
          <Text dimColor>{"─".repeat(28)}</Text>
          {orchestrator.multiStep && orchestrator.running ? (
            <Text color="yellow"> agents disagree, retrying…</Text>
          ) : orchestrator.finished ? (
            <Text color="green"> all complete</Text>
          ) : null}
        </Box>
      )}

      {dense ? (
        <DenseTable tick={tick} agents={agents} />
      ) : (
        <BoxedAgents tick={tick} agents={agents} />
      )}

      {finalSummary ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            ✔ Result
          </Text>
          <Text>{oneLine(finalSummary, 76)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function BoxedAgents({
  tick,
  agents,
}: {
  tick: number;
  agents: AgentUiRow[];
}) {
  const spin = spinnerAt(tick);
  return (
    <Box flexDirection="column">
      {agents.map((a) => {
        const tc = typeColor(a.agentKey);
        const headerIcon =
          a.status === "running" ? spin : a.status === "done" ? "☑" : "✗";
        const headerColor =
          a.status === "running" ? "cyan" : a.status === "done" ? "green" : "red";
        const sub =
          a.perspective && a.status === "running"
            ? ` — ${oneLine(a.perspective, 28)}`
            : "";
        const dur = agentDurationLabel(a);
        return (
          <Box
            key={a.runId}
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            marginBottom={1}
            paddingX={1}
          >
            <Box flexDirection="row" flexWrap="wrap">
              <Text color={headerColor}>{headerIcon} </Text>
              <Text bold> Agent {a.displayIndex} </Text>
              <Text color={tc}>({a.agentKey})</Text>
              {dur ? (
                <>
                  <Text dimColor> • </Text>
                  <Text dimColor>{dur}</Text>
                </>
              ) : null}
              {a.status === "running" && a.perspective ? (
                <Text dimColor>{sub}</Text>
              ) : null}
            </Box>
            <Box paddingLeft={0}>
              {a.status === "running" ? (
                <Text>
                  <Text color="gray">→ </Text>
                  <Text color="gray">{oneLine(a.latest, 68)}</Text>
                </Text>
              ) : a.status === "done" ? (
                <Text>
                  <Text color="green">✔ </Text>
                  <Text color="gray">{oneLine(a.resultLine ?? a.latest, 68)}</Text>
                </Text>
              ) : (
                <Text>
                  <Text color="red">✗ </Text>
                  <Text color="red">{oneLine(a.resultLine ?? a.latest, 68)}</Text>
                </Text>
              )}
            </Box>
            <Box marginTop={0}>
              <Text dimColor>{oneLine(a.task, 68)}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function DenseTable({
  tick,
  agents,
}: {
  tick: number;
  agents: AgentUiRow[];
}) {
  const spin = spinnerAt(tick);
  return (
    <Box flexDirection="column">
      <Text dimColor>AGENT      TYPE         STATUS    LATEST</Text>
      <Text dimColor>{"─".repeat(56)}</Text>
      {agents.map((a) => {
        const tc = typeColor(a.agentKey);
        const st = a.status;
        const icon = st === "running" ? spin : st === "done" ? "✔" : "✗";
        const stColor = st === "running" ? "cyan" : st === "done" ? "green" : "red";
        const latest =
          st === "running"
            ? oneLine(a.latest, 22)
            : oneLine(a.resultLine ?? a.latest, 22);
        const typeCell =
          a.agentKey.length > 12 ? `${a.agentKey.slice(0, 11)}…` : a.agentKey;
        const typePadded = typeCell.padEnd(12, " ");
        const statusPadded = st.padEnd(9, " ");
        const dur = agentDurationLabel(a);
        return (
          <Box key={a.runId} flexDirection="row" columnGap={1}>
            <Text>
              <Text color={stColor}>{icon} </Text>
              <Text bold>Agent {a.displayIndex}</Text>
              {dur ? (
                <>
                  <Text dimColor> • </Text>
                  <Text dimColor>{dur}</Text>
                </>
              ) : null}
            </Text>
            <Text color={tc}>{typePadded}</Text>
            <Text color={stColor}>{statusPadded}</Text>
            <Text dimColor>{latest}</Text>
          </Box>
        );
      })}
      {agents.length > 8 ? (
        <Box marginTop={0}>
          <Text dimColor>…</Text>
        </Box>
      ) : null}
    </Box>
  );
}
