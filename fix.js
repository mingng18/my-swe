const fs = require('fs');

// Fix for .github/workflows/ci.yml dependency audit deprecation
let ciConfig = fs.readFileSync('.github/workflows/ci.yml', 'utf-8');
ciConfig = ciConfig.replace(/uses: actions\/upload-artifact@v3/g, 'uses: actions/upload-artifact@v4');
fs.writeFileSync('.github/workflows/ci.yml', ciConfig);

// Fix src/__tests__/verification-pipeline.test.ts
let vpTest = fs.readFileSync('src/__tests__/verification-pipeline.test.ts', 'utf-8');
vpTest = vpTest.replace(/installed: false, packageManager: "null" as any,/g, 'installed: false, packageManager: "",');
vpTest = vpTest.replace(/prCreated: false, error: "Submission failed" \} as any/g, 'prCreated: false, prUrl: "" } as any');
fs.writeFileSync('src/__tests__/verification-pipeline.test.ts', vpTest);

// Fix src/subagents/__tests__/reviewerParser.test.ts
let reviewerTest = fs.readFileSync('src/subagents/__tests__/reviewerParser.test.ts', 'utf-8');
reviewerTest = reviewerTest.replace(/severity: "UNKNOWN",/g, 'severity: "UNKNOWN" as any,');
reviewerTest = reviewerTest.replace(/severity: 123,/g, 'severity: 123 as any,');
fs.writeFileSync('src/subagents/__tests__/reviewerParser.test.ts', reviewerTest);

// Fix src/utils/github/security.test.ts
let securityTest = fs.readFileSync('src/utils/github/security.test.ts', 'utf-8');
securityTest = securityTest.replace(/jest\.spyOn\(require\("\.\.\/shell"\), "shellEscapeSingleQuotes"\)/g, 'jest.spyOn(require("../shell"), "shellEscapeSingleQuotes")');
if(!securityTest.includes('import { shellEscapeSingleQuotes }')) {
    securityTest = 'import { shellEscapeSingleQuotes } from "../shell";\n' + securityTest;
}
fs.writeFileSync('src/utils/github/security.test.ts', securityTest);

// Fix src/utils/multimodal.ts
let multimodal = fs.readFileSync('src/utils/multimodal.ts', 'utf-8');
multimodal = multimodal.replace(/return \{ type: "image_url", image_url: \{ url: finalNormalizedAddress \} \};/g, 'return { type: "image_url", image_url: { url: normalizedAddress } };');
fs.writeFileSync('src/utils/multimodal.ts', multimodal);
