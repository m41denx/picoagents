import React from "react";
import { Box, Text } from "ink";
import { spinnerAt } from "@/tui/spinner.ts";

export type AgentUiRow = {
  runId: string;
  displayIndex: number;
  agentKey: string;
  status: "running" | "done" | "error";
  task: string;
  perspective?: string;
  /** Short status line while running */
  latest: string;
  /** Full subagent output when verbose mode is on */
  fullOutput?: string;
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

export function formatDurationSec(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Timers for planning / orchestrator meta rows (gray chip like subagents). */
export type MetaPhaseTimer = {
  startMs: number | null;
  endMs: number | null;
};

function metaTimerChip(opts: {
  skipped?: boolean;
  startMs: number | null;
  endMs: number | null;
  /** Elapsed while phase in progress */
  live: boolean;
}): string {
  if (opts.skipped) return "0.0s";
  if (opts.startMs != null && opts.endMs != null) {
    return formatDurationSec(opts.endMs - opts.startMs);
  }
  if (opts.live && opts.startMs != null) {
    return formatDurationSec(Date.now() - opts.startMs);
  }
  return "—";
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
  planningTimer,
  orchestratorTimer,
  orchestrator,
  orchestratorActivity,
  agents,
  finalSummary,
  verbose,
}: {
  goal: string;
  tick: number;
  planningSkipped: boolean;
  planReady: boolean;
  planningTimer: MetaPhaseTimer;
  orchestratorTimer: MetaPhaseTimer;
  orchestrator: OrchestratorUiState;
  /** Last orchestrator model step: tools / snippet (live observability). */
  orchestratorActivity?: string;
  agents: AgentUiRow[];
  finalSummary?: string;
  /** Show full result text and agent bodies without aggressive trimming. */
  verbose?: boolean;
}) {
  const spin = spinnerAt(tick);
  const dense = agents.length > 4;

  const planChip = metaTimerChip({
    skipped: planningSkipped,
    startMs: planningTimer.startMs,
    endMs: planningTimer.endMs,
    live: false,
  });

  const orchLive =
    orchestrator.running &&
    !orchestrator.finished &&
    orchestratorTimer.startMs != null &&
    orchestratorTimer.endMs == null;

  const orchChip = metaTimerChip({
    skipped: false,
    startMs: orchestratorTimer.startMs,
    endMs: orchestratorTimer.endMs,
    live: orchLive,
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box marginBottom={1} flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Text dimColor>Prompt: </Text>
          <Text>{verbose ? goal : oneLine(goal, 72)}</Text>
        </Box>
        {verbose ? (
          <Box marginTop={0}>
            <Text dimColor>Verbose — full traces also on stderr</Text>
          </Box>
        ) : null}
      </Box>

      {!dense ? (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="green">✔ </Text>
            <Text>
              Planning
              {planningSkipped ? (
                <Text dimColor> (skipped)</Text>
              ) : planReady ? null : (
                <Text dimColor> …</Text>
              )}
            </Text>
            <Text dimColor> • </Text>
            <Text dimColor>{planChip}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" marginTop={0}>
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
            <Text dimColor> • </Text>
            <Text dimColor>{orchChip}</Text>
          </Box>
          {orchestratorActivity ? (
            <Box flexDirection="row" flexWrap="wrap" marginTop={0}>
              <Text dimColor>→ </Text>
              <Text dimColor>
                {verbose
                  ? orchestratorActivity
                  : oneLine(orchestratorActivity, 76)}
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="green">✔ Planning</Text>
            {planningSkipped ? (
              <Text dimColor> (skipped)</Text>
            ) : null}
            <Text dimColor> • </Text>
            <Text dimColor>{planChip}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" marginTop={0}>
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
            <Text dimColor>{"─".repeat(20)}</Text>
            {orchestrator.multiStep && orchestrator.running ? (
              <Text color="yellow"> retrying…</Text>
            ) : orchestrator.finished ? (
              <Text color="green"> complete</Text>
            ) : null}
            <Text dimColor> • </Text>
            <Text dimColor>{orchChip}</Text>
          </Box>
          {orchestratorActivity ? (
            <Box flexDirection="row" flexWrap="wrap" marginTop={0}>
              <Text dimColor>→ </Text>
              <Text dimColor>
                {verbose
                  ? orchestratorActivity
                  : oneLine(orchestratorActivity, 76)}
              </Text>
            </Box>
          ) : null}
        </Box>
      )}

      {dense ? (
        <DenseTable tick={tick} agents={agents} verbose={verbose} />
      ) : (
        <BoxedAgents tick={tick} agents={agents} verbose={verbose} />
      )}

      {finalSummary ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            ✔ Result
          </Text>
          {verbose ? (
            finalSummary.split("\n").map((line, i) => (
              <Text key={i}>{line}</Text>
            ))
          ) : (
            <Text>{oneLine(finalSummary, 76)}</Text>
          )}
        </Box>
      ) : null}
    </Box>
  );
}

function BoxedAgents({
  tick,
  agents,
  verbose,
}: {
  tick: number;
  agents: AgentUiRow[];
  verbose?: boolean;
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
            <Box paddingLeft={0} flexDirection="column">
              {a.status === "running" ? (
                <Text>
                  <Text color="gray">→ </Text>
                  <Text color="gray">
                    {verbose ? a.latest : oneLine(a.latest, 68)}
                  </Text>
                </Text>
              ) : a.status === "done" ? (
                verbose && a.fullOutput ? (
                  <Box flexDirection="column">
                    <Text>
                      <Text color="green">✔ </Text>
                      <Text color="gray">(full output)</Text>
                    </Text>
                    {a.fullOutput.split("\n").map((line, i) => (
                      <Text key={i} color="gray">
                        {line}
                      </Text>
                    ))}
                  </Box>
                ) : (
                  <Text>
                    <Text color="green">✔ </Text>
                    <Text color="gray">
                      {oneLine(a.resultLine ?? a.latest, 68)}
                    </Text>
                  </Text>
                )
              ) : verbose && a.fullOutput ? (
                <Box flexDirection="column">
                  <Text>
                    <Text color="red">✗ </Text>
                    <Text color="red">(full output)</Text>
                  </Text>
                  {a.fullOutput.split("\n").map((line, i) => (
                    <Text key={i} color="red">
                      {line}
                    </Text>
                  ))}
                </Box>
              ) : (
                <Text>
                  <Text color="red">✗ </Text>
                  <Text color="red">
                    {oneLine(a.resultLine ?? a.latest, 68)}
                  </Text>
                </Text>
              )}
            </Box>
            <Box marginTop={0}>
              <Text dimColor>{verbose ? a.task : oneLine(a.task, 68)}</Text>
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
  verbose,
}: {
  tick: number;
  agents: AgentUiRow[];
  verbose?: boolean;
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
            ? verbose
              ? oneLine(a.latest, 44)
              : oneLine(a.latest, 22)
            : verbose && a.fullOutput
              ? oneLine(a.fullOutput, 44)
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
