const fs = require('fs');

let multimodal = fs.readFileSync('src/utils/multimodal.ts', 'utf-8');
multimodal = multimodal.replace(/finalNormalizedAddress = normalizedAddress;/g, '');
fs.writeFileSync('src/utils/multimodal.ts', multimodal);
