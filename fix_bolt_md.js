const fs = require('fs');

let content = fs.readFileSync('.jules/bolt.md', 'utf8');

const newLearning = `
## 2026-09-10 - Optimize chained array methods
**Learning:** Chained \`.map().filter()\` calls on arrays create intermediate array allocations that increase garbage collection pressure, particularly on critical paths like memory consolidation.
**Action:** Replace chained array methods with single-pass operations like \`reduce\` or \`for\` loops with in-place mutation to optimize memory usage and performance.`;

if (!content.includes('Optimize chained array methods')) {
    content += newLearning;
}

fs.writeFileSync('.jules/bolt.md', content);
