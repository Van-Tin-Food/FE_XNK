/**
 * Chạy worker cho từng phần tử, tối đa `limit` việc cùng lúc, giữ thứ tự bắt đầu theo danh sách.
 * Worker tự bắt lỗi của mình (một việc lỗi không dừng các việc còn lại); lỗi lọt ra ngoài thì vẫn chạy hết rồi mới ném.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let firstError: unknown = null;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        await worker(items[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(lanes);
  if (firstError) throw firstError;
}

/**
 * Giới hạn dùng chung cho nhiều nhóm việc bắt đầu vào các thời điểm khác nhau: tối đa `limit` việc chạy cùng lúc,
 * việc vượt giới hạn chờ theo thứ tự gọi. Lỗi của việc nào trả về đúng lời gọi đó.
 */
export function createConcurrencyLimit(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  // Xong một việc: chuyển thẳng chỗ trống cho việc đang chờ (không giảm active) để việc mới gọi chen vào không vượt giới hạn.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= Math.max(1, limit)) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
