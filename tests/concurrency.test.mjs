import test from "node:test";
import assert from "node:assert/strict";
import { createConcurrencyLimit, runWithConcurrency } from "../src/utils/concurrency.ts";

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

test("giới hạn dùng chung: nhiều nhóm gọi lệch thời điểm vẫn không vượt giới hạn, lỗi trả đúng lời gọi", async () => {
  const run = createConcurrencyLimit(2);
  let running = 0;
  let peak = 0;
  const task = (value, ms, fail = false) => () => (async () => {
    running += 1;
    peak = Math.max(peak, running);
    await wait(ms);
    running -= 1;
    if (fail) throw new Error(`lỗi ${value}`);
    return value;
  })();
  const first = Promise.allSettled([run(task(1, 10)), run(task(2, 5, true)), run(task(3, 5))]);
  await wait(7);
  // Nhóm sau gọi đúng lúc việc 2 vừa xong và việc 3 đang được nhận chỗ.
  const second = Promise.allSettled([run(task(4, 3)), run(task(5, 3))]);
  const results = [...(await first), ...(await second)];
  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => (result.status === "fulfilled" ? result.value : result.reason.message)), [1, "lỗi 2", 3, 4, 5]);
});
