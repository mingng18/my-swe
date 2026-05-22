const fs = require('fs');

let securityTest = fs.readFileSync('src/utils/github/security.test.ts', 'utf8');

// The original import might have been:
// import { shellEscapeSingleQuotes } from "../shell";
securityTest = securityTest.replace(/import \{ shellEscapeSingleQuotes as mockShellEscapeSingleQuotes \} from "\.\.\/shell";/g, 'import { checkVulnerabilities } from "./security";\nimport { shellEscapeSingleQuotes as mockShellEscapeSingleQuotes } from "../shell";');

fs.writeFileSync('src/utils/github/security.test.ts', securityTest);
