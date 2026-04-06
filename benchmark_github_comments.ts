import { bench, run } from "mitata";

const OPEN_SWE_TAGS = ["@openswe", "@open-swe", "@openswe-dev"] as const;

// Create dummy comments array
const allComments = Array.from({ length: 1000 }).map((_, i) => ({
  body: i % 100 === 0 ? `Hello @openswe ${i}` : `Just a normal comment ${i}`,
  created_at: new Date().toISOString(),
}));

bench("Current Implementation", () => {
    const tagIndices = allComments
      .map((comment, i) => ({
        index: i,
        body: (comment.body ?? "").toLowerCase(),
      }))
      .filter(({ body }) => OPEN_SWE_TAGS.some((tag) => body.includes(tag)))
      .map(({ index }) => index);
    return tagIndices;
});

bench("Optimized Implementation (reduce)", () => {
    const tagIndices = allComments.reduce((acc, comment, i) => {
        const body = (comment.body ?? "").toLowerCase();
        if (OPEN_SWE_TAGS.some((tag) => body.includes(tag))) {
            acc.push(i);
        }
        return acc;
    }, [] as number[]);
    return tagIndices;
});

await run();
