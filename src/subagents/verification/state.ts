import { Annotation } from "@langchain/langgraph";

export const VerificationStateAnnotation = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  verdict: Annotation<string>({
    default: () => "",
  }),
  status: Annotation<"running" | "complete" | "error">({
    default: () => "running",
  }),
});
