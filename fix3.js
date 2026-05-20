const fs = require('fs');

let vpTest = fs.readFileSync('src/__tests__/verification-pipeline.test.ts', 'utf-8');
vpTest = vpTest.replace(/installed: false, packageManager: null/g, 'installed: false, packageManager: "" as any');
vpTest = vpTest.replace(/prCreated: false, error: "Submission failed"/g, 'prCreated: false, error: "Submission failed", prUrl: "" as any');
fs.writeFileSync('src/__tests__/verification-pipeline.test.ts', vpTest);

let reviewerTest = fs.readFileSync('src/subagents/__tests__/reviewerParser.test.ts', 'utf-8');
reviewerTest = reviewerTest.replace(/severity: "UNKNOWN",/g, 'severity: "UNKNOWN" as any,');
reviewerTest = reviewerTest.replace(/severity: 123,/g, 'severity: 123 as any,');
fs.writeFileSync('src/subagents/__tests__/reviewerParser.test.ts', reviewerTest);

let securityTest = fs.readFileSync('src/utils/github/security.test.ts', 'utf-8');
if(!securityTest.includes('import { shellEscapeSingleQuotes }')) {
    securityTest = 'import { shellEscapeSingleQuotes } from "../shell";\n' + securityTest;
}
securityTest = securityTest.replace(/jest\.spyOn\([^,]+, "shellEscapeSingleQuotes"\)/g, 'jest.spyOn(require("../shell"), "shellEscapeSingleQuotes")');
fs.writeFileSync('src/utils/github/security.test.ts', securityTest);

let multimodal = fs.readFileSync('src/utils/multimodal.ts', 'utf-8');
multimodal = multimodal.replace(/image_url: \{ url: finalNormalizedAddress \}/g, 'image_url: { url: normalizedAddress }');
fs.writeFileSync('src/utils/multimodal.ts', multimodal);
