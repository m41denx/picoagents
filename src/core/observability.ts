/** Enable verbose traces when true or when `PICOAGENT_VERBOSE=1`. */
export function resolveVerbose(flag?: boolean): boolean {
  if (flag === true) return true;
  return process.env["PICOAGENT_VERBOSE"] === "1";
}

export type ModelStepTrace = {
  stepNumber: number;
  finishReason: string;
  text: string;
  reasoningText?: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
  toolResults: Array<{ toolName: string; output: unknown }>;
};

/** Normalize AI SDK step events for logging (tool inputs/outputs as plain JSON). */
export function serializeModelStep(event: {
  stepNumber: number;
  finishReason: string;
  text: string;
  reasoningText?: string | undefined;
  staticToolCalls?: ReadonlyArray<{ toolName: string; input: unknown }>;
  toolCalls?: ReadonlyArray<{ toolName: string; input: unknown }>;
  staticToolResults?: ReadonlyArray<{ toolName: string; output: unknown }>;
  toolResults?: ReadonlyArray<{ toolName: string; output: unknown }>;
}): ModelStepTrace {
  const toolCalls: ModelStepTrace["toolCalls"] = [];
  for (const c of event.staticToolCalls ?? []) {
    toolCalls.push({ toolName: String(c.toolName), input: c.input });
  }
  for (const c of event.toolCalls ?? []) {
    toolCalls.push({ toolName: String(c.toolName), input: c.input });
  }
  const toolResults: ModelStepTrace["toolResults"] = [];
  for (const r of event.staticToolResults ?? []) {
    toolResults.push({ toolName: String(r.toolName), output: r.output });
  }
  for (const r of event.toolResults ?? []) {
    toolResults.push({ toolName: String(r.toolName), output: r.output });
  }
  return {
    stepNumber: event.stepNumber,
    finishReason: event.finishReason,
    text: event.text,
    reasoningText: event.reasoningText,
    toolCalls,
    toolResults,
  };
}

export function emitTraceLine(scope: string, payload: unknown): void {
  let body: string;
  try {
    body =
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload, (_k, v) => {
            if (typeof v === "string" && v.length > 120_000) {
              return `${v.slice(0, 120_000)}… [truncated ${v.length} chars]`;
            }
            return v;
          }, 2);
  } catch {
    body = String(payload);
  }
  console.error(`[picoagents:${scope}] ${body}`);
}
