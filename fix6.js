const fs = require('fs');

let reviewerTest = fs.readFileSync('src/subagents/__tests__/reviewerParser.test.ts', 'utf-8');
reviewerTest = reviewerTest.replace(/const unorderedIssues = \[\n\s+\{ severity: "LOW",/g, 'const unorderedIssues: any[] = [\n      { severity: "LOW",');
reviewerTest = reviewerTest.replace(/const mixedIssues = \[\n\s+\{ severity: "HIGH",/g, 'const mixedIssues: any[] = [\n      { severity: "HIGH",');
fs.writeFileSync('src/subagents/__tests__/reviewerParser.test.ts', reviewerTest);
