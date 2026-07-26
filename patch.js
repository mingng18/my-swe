const fs = require('fs');
const file = 'src/hooks/__tests__/hooks.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`  it("maintains a singleton instance via getHooksDispatcher", () => {
    const d1 = getHooksDispatcher();
    const d2 = getHooksDispatcher();
    expect(d1).toBe(d2);
  });`,
`  it("maintains a singleton instance via getHooksDispatcher", async () => {
    const d1 = await getHooksDispatcher();
    const d2 = await getHooksDispatcher();
    expect(d1).toBe(d2);
  });`);

code = code.replace(
`  it("creates a new instance after resetHooksDispatcher is called", () => {
    const d1 = getHooksDispatcher();
    resetHooksDispatcher();
    const d2 = getHooksDispatcher();
    expect(d1).not.toBe(d2);
  });`,
`  it("creates a new instance after resetHooksDispatcher is called", async () => {
    const d1 = await getHooksDispatcher();
    resetHooksDispatcher();
    const d2 = await getHooksDispatcher();
    expect(d1).not.toBe(d2);
  });`);

fs.writeFileSync(file, code);
