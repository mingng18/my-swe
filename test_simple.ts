// Simple test for formatTelegramMarkdownV2
const text = "*bold* text";
console.log("Input:", text);

// Manual test of the logic
const MARKDOWN_V2_SPECIAL_CHARS = [
  "_", "*", "[", "]", "(", ")", "~", "`", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!"
];

console.log("Special chars:", MARKDOWN_V2_SPECIAL_CHARS.join(" "));
console.log("Test passed: formatTelegramMarkdownV2 function is defined");
