import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_FILE_ACCEPT,
  DOCUMENT_FILE_EXTENSIONS,
  getDocumentMimeType,
  isSupportedDocumentFile,
} from "../src/utils/documentFile.ts";

test("accepts every configured document and image extension", () => {
  for (const extension of DOCUMENT_FILE_EXTENSIONS) {
    assert.equal(isSupportedDocumentFile({ name: `document.${extension.toUpperCase()}` }), true);
    assert.match(DOCUMENT_FILE_ACCEPT, new RegExp(`\\.${extension}(?:,|$)`));
  }
});

test("rejects unsupported and extensionless files", () => {
  assert.equal(isSupportedDocumentFile({ name: "malware.exe" }), false);
  assert.equal(isSupportedDocumentFile({ name: "README" }), false);
});

test("keeps the browser MIME type or infers it from the extension", () => {
  assert.equal(getDocumentMimeType({ name: "scan.png", type: "image/png" }), "image/png");
  assert.equal(getDocumentMimeType({ name: "invoice.docx", type: "" }), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(getDocumentMimeType({ name: "photo.tiff", type: "" }), "image/tiff");
});

