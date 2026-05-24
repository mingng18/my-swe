const fs = require('fs');
const filePath = 'src/memory/search.ts';
let code = fs.readFileSync(filePath, 'utf8');

const target = `    for (const memory of memories) {
      const titleLower = memory.title.toLowerCase();
      const contentLower = memory.content.toLowerCase();
      const searchText = \`\${titleLower} \${contentLower}\`;

      // Calculate keyword relevance score
      let score = 0;
      let matchedTerms = 0;

      for (const term of queryTerms) {
        if (titleLower.includes(term)) {
          score += 0.3; // Title matches are weighted higher
          matchedTerms++;
        }
        if (contentLower.includes(term)) {
          score += 0.1;
          matchedTerms++;
        }
      }`;

const replacement = `    // ⚡ Bolt Optimization: Use a single compiled regex to find all matching terms at once
    // instead of scanning the full string multiple times with string.includes()
    const escapedTerms = queryTerms.map((t) => {
      let escaped = "";
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (".*+?^$()|[]\\\\{}".includes(c)) escaped += "\\\\";
        escaped += c;
      }
      return escaped;
    });
    const termRegex = new RegExp(escapedTerms.join("|"), "g");

    for (const memory of memories) {
      const titleLower = memory.title.toLowerCase();
      const contentLower = memory.content.toLowerCase();

      // Calculate keyword relevance score
      let score = 0;
      let matchedTerms = 0;

      termRegex.lastIndex = 0;
      const titleMatches = new Set<string>();
      let match;
      while ((match = termRegex.exec(titleLower)) !== null) {
        titleMatches.add(match[0]);
        if (titleMatches.size === queryTerms.length) break;
      }

      termRegex.lastIndex = 0;
      const contentMatches = new Set<string>();
      while ((match = termRegex.exec(contentLower)) !== null) {
        contentMatches.add(match[0]);
        if (contentMatches.size === queryTerms.length) break;
      }

      for (let i = 0; i < queryTerms.length; i++) {
        const term = queryTerms[i];
        if (titleMatches.has(term)) {
          score += 0.3; // Title matches are weighted higher
          matchedTerms++;
        }
        if (contentMatches.has(term)) {
          score += 0.1;
          matchedTerms++;
        }
      }`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync(filePath, code, 'utf8');
    console.log('Success replacing block');
} else {
    console.log('Failed to find block');
}
