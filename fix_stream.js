const fs = require('fs');
const file = 'tests/stream.test.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /\n\s*\/\/ Close emitter\n\s*/g,
  '\n    // Close emitter\n    streamRegistry.closeStream(threadId);\n'
);

fs.writeFileSync(file, content);
