sed -i 's/extractor.extract(turn.input, turn.agentReply, turn.threadId)/extractor.extractFromTurn(turn)/g' src/memory/integration.test.ts
