import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("assets/app.js", "utf8");

const context = {
  console,
  navigator: { clipboard: { writeText() {} } },
  setTimeout,
  URL,
  URLSearchParams,
  HTMLSelectElement: class HTMLSelectElement {},
};
context.window = {
  __TSENV_DISABLE_AUTORUN__: true,
  __TSENV_ENABLE_TEST_API__: true,
  addEventListener() {},
  requestAnimationFrame(callback) {
    callback();
  },
};
context.document = {
  addEventListener() {},
  getElementById() {
    return { innerHTML: "" };
  },
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: "assets/app.js" });

const api = context.window.__TSENV_TEST__;
assert.ok(api, "app.js should expose test helpers");

const description = {
  observed_channels: [
    { id: "x", label: "x" },
    { id: "v", label: "v" },
  ],
  prompt_combinations: [
    { task_type: "code", desc_level: "high", training_samples: ">0", agent_instruction: "code-high-examples" },
    { task_type: "code", desc_level: "high", training_samples: "none", agent_instruction: "code-high-none" },
  ],
};
const data = {
  run_id: "sample-run",
  rows: Array.from({ length: 80 }, (_, index) => ({
    time: index * 0.1,
    x: Math.sin(index / 8),
    v: Math.cos(index / 8),
  })),
};

function rmsDelta(leftRows, rightRows, column) {
  const sum = leftRows.reduce((acc, row, index) => {
    const delta = Number(row[column]) - Number(rightRows[index][column]);
    return acc + delta * delta;
  }, 0);
  return Math.sqrt(sum / leftRows.length);
}

const clean = api.dataWithPlotNoise(data, description, { noise: "None" });
assert.equal(JSON.stringify(clean.rows), JSON.stringify(data.rows), "No Noise should preserve plotted values");
assert.notEqual(clean.rows[0], data.rows[0], "No Noise should still return copied row objects");

const low = api.dataWithPlotNoise(data, description, { noise: "Low" });
const lowRepeat = api.dataWithPlotNoise(data, description, { noise: "Low" });
const high = api.dataWithPlotNoise(data, description, { noise: "High" });

assert.deepEqual(low.rows, lowRepeat.rows, "noise should be deterministic for the same run and profile");
assert.deepEqual(low.rows.map(row => row.time), data.rows.map(row => row.time), "noise must not alter time");
assert.ok(rmsDelta(low.rows, data.rows, "x") > 0, "Low Noise should alter signal values");
assert.ok(
  rmsDelta(high.rows, data.rows, "x") > rmsDelta(low.rows, data.rows, "x"),
  "High Noise should perturb the plot more than Low Noise"
);

const promptLowNoise = api.findPrompt(description, {
  taskMode: "Code",
  noise: "Low",
  context: "High",
  examples: "Three Examples",
});
const promptHighNoise = api.findPrompt(description, {
  taskMode: "Code",
  noise: "High",
  context: "High",
  examples: "Three Examples",
});
assert.equal(
  promptLowNoise.agent_instruction,
  promptHighNoise.agent_instruction,
  "noise-only changes must not change prompt selection"
);

console.log("noise behavior ok");
