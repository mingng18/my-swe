import { StateGraph } from "@langchain/langgraph";
import { createChatModel } from "../../utils/model-factory";
import { loadModelConfig } from "../../utils/config";
import { VerificationStateAnnotation } from "./state";
import { verificationSystemPrompt } from "./prompt";

export async function getVerificationGraph() {
  const modelConfig = loadModelConfig();
  const model = await createChatModel(modelConfig);

  const verificationNode = async (state: typeof VerificationStateAnnotation.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const userContent = lastMessage.content;

    const prompt = [
      { role: "system", content: verificationSystemPrompt },
      ...state.messages,
    ];

    const response = await model.invoke(prompt);

    return {
      messages: [...state.messages, response],
      verdict: extractVerdict(response.content as string),
      status: "complete" as const,
    };
  };

  function extractVerdict(content: string): string {
    const match = content.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/i);
    if (match) {
      return `VERDICT: ${match[1].toUpperCase()}`;
    }
    return "VERDICT: PARTIAL\n\nNote: No explicit verdict found in output.";
  }

  const graph = new StateGraph(VerificationStateAnnotation)
    .addNode("verification", verificationNode)
    .addEdge("__start__", "verification")
    .addEdge("verification", "__end__");

  return graph.compile();
}
