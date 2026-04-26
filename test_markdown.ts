import { formatTelegramMarkdownV2 } from "./src/utils/telegram.ts";

console.log("Test 1 - Bold text:", formatTelegramMarkdownV2("*bold* text"));
console.log("Test 2 - Special chars:", formatTelegramMarkdownV2("Check value: 5.5!"));
console.log("Test 3 - Mixed:", formatTelegramMarkdownV2("Use *bold* and _italic_"));
console.log("Test 4 - Code:", formatTelegramMarkdownV2("`code` example"));
console.log("Test 5 - Link:", formatTelegramMarkdownV2("[link](https://example.com)"));
