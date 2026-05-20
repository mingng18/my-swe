const fs = require('fs');

let vpTest = fs.readFileSync('src/__tests__/verification-pipeline.test.ts', 'utf-8');
vpTest = vpTest.replace(/packageManager: null,/g, 'packageManager: "" as any,');
vpTest = vpTest.replace(/prCreated: false,\n\s+error: "Submission failed",/g, 'prCreated: false,\n        error: "Submission failed",\n        prUrl: "" as any,');
fs.writeFileSync('src/__tests__/verification-pipeline.test.ts', vpTest);

let reviewerTest = fs.readFileSync('src/subagents/__tests__/reviewerParser.test.ts', 'utf-8');
reviewerTest = reviewerTest.replace(/severity: "UNKNOWN",/g, 'severity: "UNKNOWN" as any,');
reviewerTest = reviewerTest.replace(/severity: 123,/g, 'severity: 123 as any,');
fs.writeFileSync('src/subagents/__tests__/reviewerParser.test.ts', reviewerTest);

let multimodal = fs.readFileSync('src/utils/multimodal.ts', 'utf-8');
multimodal = multimodal.replace(/url: finalNormalizedAddress/g, 'url: normalizedAddress');
fs.writeFileSync('src/utils/multimodal.ts', multimodal);
