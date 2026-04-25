/**
 * Generic abstraction over any Agent Framework (DeepAgents, LangGraph, etc.)
 */
export interface AgentResponse {
  reply: string;
  error?: string;
  messages?: any[];
}

export interface AgentInvokeOptions {
  threadId?: string;
  userId?: string;
  transport?: "telegram" | "http" | "github";
}

export interface AgentHarness {
  /**
   * Run the agent to completion.
   * @param input The user input text.
   * @param options Execution options like threadId.
   */
  invoke(input: string, options?: AgentInvokeOptions): Promise<AgentResponse>;

  /**
   * Stream the agent execution updates.
   * @param input The user input text.
   * @param options Execution options like threadId.
   */
  stream(
    input: string,
    options?: AgentInvokeOptions,
  ): AsyncGenerator<any, void, unknown>;

  /**
   * Run the agent (alias for invoke or customized run flow).
   */
  run(input: string, options?: AgentInvokeOptions): Promise<AgentResponse>;

  /**
   * Get the current state of the agent for a given thread.
   */
  getState(threadId: string): Promise<any>;
}
