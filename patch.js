const fs = require('fs');
let code = fs.readFileSync('src/harness/deepagents.ts', 'utf8');

const target = `  logger.info(
    \`[agent-trace] [\${src}] \${mode} \${stringifyPayloadForTrace(payload, 280)}\`,
  );`;

const replacement = `  logger.error(
    { payload },
    \`[agent-trace] [\${src}] \${mode} \${stringifyPayloadForTrace(payload, 280)}\`,
  );`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/harness/deepagents.ts', code);
    console.log("Successfully patched.");
} else {
    console.log("Could not find target block.");
}
