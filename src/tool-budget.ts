/**
 * @internal A request's tool-call allowance (GenerationOptions.maximumToolCalls).
 * The session attaches one to each of its tools for the duration of a request;
 * a tool call runs only while every attached budget has room.
 */
export class ToolCallBudget {
  used = 0;
  /**
   * Set when a tool fails the request with FailRequestError: the error itself
   * can't cross the native boundary, only its message, so the session reads it
   * from here to fill in the rejection's toolName and cause.
   */
  failure: { toolName: string; cause: Error } | null = null;
  constructor(readonly max: number) {}
}
