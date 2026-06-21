import { StateGraph, Annotation, MemorySaver } from "@langchain/langgraph";

// State annotation for the main agent graph
const AgentState = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  threadId: Annotation<string>(),
  input: Annotation<string>(),
});

// The graph is a simple passthrough to the DeepAgent harness
// since all orchestration is in middleware
export function getGraphForExport() {
  const graph = new StateGraph(AgentState)
    .addNode("agent", async (state) => {
      // The real work is delegated to the harness via server.ts
      // This graph exists so LangGraph Cloud can deploy it
      const { runCodeagentTurn } = await import("./server.js");
      const reply = await runCodeagentTurn(state.input, state.threadId);
      return {
        messages: [{ role: "assistant", content: reply }],
      };
    })
    .addEdge("__start__", "agent")
    .addEdge("agent", "__end__");

  return graph.compile({ checkpointer: new MemorySaver() });
}
