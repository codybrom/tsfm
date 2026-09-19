/**
 * @internal A request's tool-call allowance (GenerationOptions.maximumToolCalls).
 * The session attaches one to each of its tools for the duration of a request;
 * a tool call runs only while every attached budget has room.
 */
export class ToolCallBudget {
  used = 0;
  constructor(readonly max: number) {}
}
