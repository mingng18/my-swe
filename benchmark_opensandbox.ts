import { test, expect } from "bun:test";
import { performance } from "node:perf_hooks";

// Mock log entries to simulate a large execution log
const numLogs = 100000;
const logEntries = Array.from({ length: numLogs }, (_, i) => ({ text: `Log entry number ${i} with some extra text to make it longer.\n` }));

function mapAndJoin(logs: { text: string }[]) {
  return logs.map((log) => log.text).join("");
}

function reduceJoin(logs: { text: string }[]) {
  return logs.reduce((acc, log) => acc + log.text, "");
}

const runBenchmark = () => {
    console.log(`Running benchmark with ${numLogs} log entries...`);

    // Warmup
    for(let i=0; i<10; i++) {
        mapAndJoin(logEntries);
        reduceJoin(logEntries);
    }

    let start = performance.now();
    for (let i = 0; i < 100; i++) {
        mapAndJoin(logEntries);
    }
    let end = performance.now();
    const mapAndJoinTime = end - start;
    console.log(`mapAndJoin: ${mapAndJoinTime.toFixed(2)} ms`);

    start = performance.now();
    for (let i = 0; i < 100; i++) {
        reduceJoin(logEntries);
    }
    end = performance.now();
    const reduceJoinTime = end - start;
    console.log(`reduceJoin: ${reduceJoinTime.toFixed(2)} ms`);

    const improvement = ((mapAndJoinTime - reduceJoinTime) / mapAndJoinTime) * 100;
    console.log(`Improvement: ${improvement.toFixed(2)}%`);
};

runBenchmark();
