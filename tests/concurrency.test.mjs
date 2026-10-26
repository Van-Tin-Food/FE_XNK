import test from "node:test";
import assert from "node:assert/strict";
import { runWithConcurrency } from "../src/utils/concurrency.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("không chạy quá số việc cùng lúc và chạy đủ mọi phần tử", async () => {
  let running = 0;
  let peak = 0;
  const done = [];
  await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await wait(5 + (item % 3) * 3);
    done.push(item);
    running -= 1;
  });
  assert.equal(peak, 3);
  assert.deepEqual([...done].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
});

test("bắt đầu theo đúng thứ tự danh sách", async () => {
  const started = [];
  await runWithConcurrency(["a", "b", "c", "d"], 2, async (item) => {
    started.push(item);
    await wait(1);
  });
  assert.deepEqual(started, ["a", "b", "c", "d"]);
});

test("một việc lỗi vẫn chạy hết các việc còn lại rồi mới báo lỗi", async () => {
  const done = [];
  await assert.rejects(runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
    await wait(1);
    if (item === 2) throw new Error("boom");
    done.push(item);
  }), /boom/);
  assert.deepEqual([...done].sort(), [1, 3, 4]);
});

test("danh sách rỗng: không làm gì", async () => {
  let calls = 0;
  await runWithConcurrency([], 3, async () => { calls += 1; });
  assert.equal(calls, 0);
});
