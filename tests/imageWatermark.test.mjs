import test from "node:test";
import assert from "node:assert/strict";
import { shouldWatermark, watermarkLayout } from "../src/utils/imageWatermark.ts";

test("chỉ đóng dấu ảnh JPG / PNG / WEBP của chứng từ INSPECTION", () => {
  for (const name of ["a.jpg", "b.JPEG", "c.png", "d.webp"]) assert.equal(shouldWatermark("INSPECTION", { name }), true, name);
  for (const name of ["e.heic", "f.mp4", "g.pdf", "h"]) assert.equal(shouldWatermark("INSPECTION", { name }), false, name);
  assert.equal(shouldWatermark("inspection", { name: "a.jpg" }), true);
  assert.equal(shouldWatermark("TRA_CONT", { name: "a.jpg" }), false);
  assert.equal(shouldWatermark("PKL", { name: "a.png" }), false);
});

test("logo rộng 40% ảnh, đậm 75%, căn giữa, cách đáy 4%", () => {
  const layout = watermarkLayout(4000, 3000, 4000, 2866);
  assert.equal(layout.width, 1600);
  assert.equal(layout.height, Math.round(1600 * 2866 / 4000));
  assert.equal(layout.x, 1200);
  assert.equal(layout.y, Math.round(3000 - 120 - 1600 * 2866 / 4000));
  assert.equal(layout.opacity, 0.75);
});

test("ảnh dọc / ảnh rất thấp: logo không vượt khung ảnh", () => {
  const portrait = watermarkLayout(3000, 4000, 4000, 2866);
  assert.ok(portrait.y + portrait.height <= 4000);
  assert.equal(portrait.x, Math.round((3000 - portrait.width) / 2));
  const banner = watermarkLayout(4000, 300, 4000, 2866);
  assert.ok(banner.height <= 300 * 0.9 + 1);
  assert.ok(banner.y >= 0);
});

test("lớp logo lặp chéo phủ kín cả ảnh ở mọi góc xoay", async () => {
  const { tiledWatermarkLayout } = await import("../src/utils/imageWatermark.ts");
  for (const randomValue of [0, 0.5, 0.999]) {
    const { angle, tiles } = tiledWatermarkLayout(4000, 3000, 4000, 2866, () => randomValue);
    assert.ok(angle <= (-20 * Math.PI) / 180 + 1e-9 && angle >= (-35 * Math.PI) / 180 - 1e-9);
    // Bốn góc ảnh (đổi sang hệ đã xoay) đều nằm trong vùng lưới.
    const minX = Math.min(...tiles.map((tile) => tile.x));
    const maxX = Math.max(...tiles.map((tile) => tile.x + tile.width));
    const minY = Math.min(...tiles.map((tile) => tile.y));
    const maxY = Math.max(...tiles.map((tile) => tile.y + tile.height));
    for (const [cx, cy] of [[-2000, -1500], [2000, -1500], [-2000, 1500], [2000, 1500]]) {
      const x = cx * Math.cos(-angle) - cy * Math.sin(-angle);
      const y = cx * Math.sin(-angle) + cy * Math.cos(-angle);
      assert.ok(x >= minX && x <= maxX && y >= minY && y <= maxY, `góc (${cx}, ${cy}) chưa được phủ`);
    }
    assert.equal(tiles[0].width, 480, "logo nhỏ = 16% cạnh ngắn");
    for (const tile of tiles) assert.ok(tile.opacity >= 0.24 && tile.opacity <= 0.36);
  }
});

test("mỗi ảnh một kiểu: góc xoay / vị trí lưới khác nhau khi số ngẫu nhiên khác nhau", async () => {
  const { tiledWatermarkLayout } = await import("../src/utils/imageWatermark.ts");
  const a = tiledWatermarkLayout(4000, 3000, 4000, 2866, () => 0.1);
  const b = tiledWatermarkLayout(4000, 3000, 4000, 2866, () => 0.8);
  assert.notEqual(a.angle, b.angle);
  assert.notEqual(a.tiles[0].x, b.tiles[0].x);
});
