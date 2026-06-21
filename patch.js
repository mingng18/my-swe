const fs = require('fs');
let content = fs.readFileSync('src/tools/__tests__/fetch-url.test.ts', 'utf8');

const searchStr = `    const dnsSpy = spyOn(dns, "lookup").mockImplementation((hostname, callback) => {
        // @ts-ignore
        callback(null, "93.184.215.14", 4);
    });`;

const replacementStr = `    const dnsSpy = spyOn(dns, "lookup").mockImplementation(((hostname: any, callback: any) => {
        callback(null, "93.184.215.14", 4);
    }) as any);`;

if (content.includes(searchStr)) {
    content = content.replace(searchStr, replacementStr);
    fs.writeFileSync('src/tools/__tests__/fetch-url.test.ts', content);
    console.log("Replaced successfully!");
} else {
    console.log("Could not find the search string");
}
