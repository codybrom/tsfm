import { randomUUID } from "node:crypto";

/**
 * @internal A request's tool-call allowance (GenerationOptions.maximumToolCalls).
 * The session attaches one to each of its private tool registrations for the
 * duration of a request. Concurrent sessions never share a budget.
 */
export class ToolCallBudget {
  used = 0;
  /**
   * Failures from calls made while this budget was active. Each failure gets an ID carried
   * through the native error message. The session attaches only the matching
   * failure.
   */
  failures = new Map<string, { toolName: string; cause: Error }>();
  constructor(readonly max: number) {}
}

/** @internal Records a failure and returns its message for the native bridge. */
export function recordToolFailure(
  budgets: Iterable<ToolCallBudget>,
  toolName: string,
  cause: Error,
): string {
  const id = randomUUID();
  for (const budget of budgets) budget.failures.set(id, { toolName, cause });
  return `[tsfm-tool-failure:${id}] ${cause.message}`;
}

/** @internal Removes the correlation marker, including from a JSON-quoted error. */
export function parseToolFailure(detail: string): { id: string | null; message: string } {
  const marker = /\[tsfm-tool-failure:([0-9a-f-]{36})\] /;
  const match = marker.exec(detail);
  return { id: match?.[1] ?? null, message: detail.replace(marker, "") };
}
