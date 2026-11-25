import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { durationMs, label, toSteps } from "@/lib/steps";
import type { StreamStatus } from "@/useAgentStream";
import type { AgentEvent } from "@/types";

/**
 * The live agent trace: one collapsible line per tool call.
 *
 * A line shows a spinner (status "running") until its result arrives, then the
 * duration; it turns red if the tool returned an error. Expanding a line shows
 * the raw arguments and result, for anyone who wants to check the agent's work.
 */
export function AgentTrace({ events, status }: { events: AgentEvent[]; status: StreamStatus }) {
  // submit_annotation is shown by the annotation card, not as a step,
  // except when it was rejected (self-correction is worth seeing).
  const steps = toSteps(events).filter(
    (s) => s.call.tool !== "submit_annotation" || s.result?.result.error,
  );
  if (status === "idle") return null;

  return (
    <TraceCollapsible defaultOpen>
      <TraceCollapsibleTrigger>
        <TraceLine status={status === "running" ? "running" : undefined}>
          <TraceTitle>
            {status === "running" ? "Analyzing…" : `Analyzed in ${steps.length} steps`}
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {steps.map((s, i) => (
            <TraceCollapsible key={i}>
              <TraceCollapsibleTrigger>
                <TraceLine
                  status={!s.result ? "running" : s.result.result.error ? "error" : undefined}
                >
                  <TraceTitle>{label(s)}</TraceTitle>
                  {s.result && <TraceDescription>{durationMs(s)} ms</TraceDescription>}
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <CodeBlock size="sm">
                  <CodeBlockContent wrap className="max-h-64">
                    {JSON.stringify({ args: s.call.args, result: s.result?.result }, null, 2)}
                  </CodeBlockContent>
                </CodeBlock>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          ))}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
