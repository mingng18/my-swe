import { Annotation } from "@langchain/langgraph";

export const VerificationStateAnnotation = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  verdict: Annotation<string>,
  status: Annotation<"running" | "complete" | "error">,
});
