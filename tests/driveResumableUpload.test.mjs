import test from "node:test";
import assert from "node:assert/strict";

// Drive giả: phiên resumable nhận các phần theo Content-Range, chỉ tạo file khi nhận byte cuối.
const sessions = new Map();
const requests = [];
globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)) };
globalThis.XMLHttpRequest = class {
  constructor() {
    this.upload = {};
    this.headers = {};
  }
  open(method, url) { this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  getResponseHeader(name) { return name === "Range" ? this.range : null; }
  abort() {}
  async send(body) {
    const session = sessions.get(this.url);
    const contentRange = this.headers["Content-Range"];
    requests.push({ contentRange, size: body ? body.size : 0 });
    if (!session) {
      this.status = 404;
    } else if (!body) {
      // Hỏi trạng thái "bytes */total".
      if (session.fileId) {
        this.status = 200;
        this.responseText = JSON.stringify({ id: session.fileId });
      } else {
        this.status = 308;
        this.range = session.received > 0 ? `bytes=0-${session.received - 1}` : null;
      }
    } else {
      const [, start, end, total] = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/).map(Number);
      assert.equal(start, session.received, "gửi tiếp đúng byte Google đang chờ");
      assert.equal(body.size, end - start + 1);
      const last = end + 1 === total;
      if (!last) assert.equal(body.size % (256 * 1024), 0, "phần không phải phần cuối là bội số 256 KB");
      session.received = end + 1;
      if (last) {
        session.fileId = `file-${this.url}`;
        this.status = 200;
        this.responseText = JSON.stringify({ id: session.fileId });
      } else {
        this.status = 308;
        this.range = `bytes=0-${end}`;
      }
    }
    this.upload.onprogress?.({ loaded: body ? body.size : 0 });
    queueMicrotask(() => this.onload());
  }
};

const { preUploadToDriveSession, uploadFileToDriveSession } = await import("../src/utils/driveResumableUpload.ts");

const fileOf = (size) => new File([new Uint8Array(size)], "a.pdf");
const open = (url) => sessions.set(url, { received: 0, fileId: null });

test("gửi trước chừa phần cuối: Drive chưa tạo file, gửi tiếp chỉ gửi phần còn lại", async () => {
  const size = 3 * 1024 * 1024 + 12345;
  open("s1");
  requests.length = 0;
  const sent = await preUploadToDriveSession("s1", fileOf(size));
  assert.equal(sent, 3 * 1024 * 1024);
  assert.equal(sessions.get("s1").fileId, null, "chưa có file trên Drive");

  requests.length = 0;
  const progress = [];
  const result = await uploadFileToDriveSession("s1", fileOf(size), { resume: true, onProgress: ({ loaded }) => progress.push(loaded) });
  assert.equal(result.id, "file-s1");
  assert.deepEqual(requests.map((request) => request.contentRange), [`bytes */${size}`, `bytes ${3 * 1024 * 1024}-${size - 1}/${size}`]);
  assert.equal(progress.at(-1), size);
});

test("file nhỏ hơn 256 KB: không gửi trước, lần gửi sau gửi cả file", async () => {
  open("s2");
  requests.length = 0;
  assert.equal(await preUploadToDriveSession("s2", fileOf(1000)), 0);
  assert.equal(requests.length, 0);
  const result = await uploadFileToDriveSession("s2", fileOf(1000), { resume: true });
  assert.equal(result.id, "file-s2");
});

test("đúng bội số 256 KB: vẫn chừa phần cuối để Drive chưa tạo file", async () => {
  const size = 512 * 1024;
  open("s3");
  assert.equal(await preUploadToDriveSession("s3", fileOf(size)), 256 * 1024);
  assert.equal(sessions.get("s3").fileId, null);
  assert.equal((await uploadFileToDriveSession("s3", fileOf(size), { resume: true })).id, "file-s3");
});

test("không resume vẫn gửi từ đầu như cũ; phiên hết hạn thì báo lỗi", async () => {
  open("s4");
  assert.equal((await uploadFileToDriveSession("s4", fileOf(300 * 1024))).id, "file-s4");
  await assert.rejects(uploadFileToDriveSession("missing", fileOf(10), { resume: true }), (error) => /hết hạn/.test(error.message) && error.sessionExpired === true);
  await assert.rejects(uploadFileToDriveSession("missing", fileOf(10)), (error) => error.sessionExpired === true);
});
