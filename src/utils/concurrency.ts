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
