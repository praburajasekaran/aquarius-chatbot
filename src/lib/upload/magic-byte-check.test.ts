import { describe, expect, it } from "vitest";
import { checkMagicBytes } from "./magic-byte-check";

const JPEG_HEAD = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);
const OLE_HEAD = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00,
]);
const RTF_HEAD = Buffer.from("{\\rtf1\\ansi");

function heifHead(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from(`ftyp${brand}`),
    Buffer.alloc(16),
  ]);
}

describe("checkMagicBytes", () => {
  it("accepts jpg uploads declared with the image/jpg alias", async () => {
    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: JPEG_HEAD,
        declared: "image/jpg",
      })
    ).resolves.toMatchObject({
      ok: true,
      detected: "image/jpeg",
      declared: "image/jpg",
    });
  });

  it("accepts HEIC and HEIF family uploads", async () => {
    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: heifHead("heic"),
        declared: "image/heic",
      })
    ).resolves.toMatchObject({ ok: true, detected: "image/heic" });

    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: heifHead("mif1"),
        declared: "image/heif",
      })
    ).resolves.toMatchObject({ ok: true, detected: "image/heif" });
  });

  it("accepts legacy DOC compound-file uploads", async () => {
    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: OLE_HEAD,
        declared: "application/msword",
      })
    ).resolves.toMatchObject({
      ok: true,
      detected: "application/x-cfb",
      declared: "application/msword",
    });
  });

  it("accepts RTF uploads declared as application/rtf or text/rtf", async () => {
    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: RTF_HEAD,
        declared: "application/rtf",
      })
    ).resolves.toMatchObject({ ok: true, detected: "application/rtf" });

    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: RTF_HEAD,
        declared: "text/rtf",
      })
    ).resolves.toMatchObject({
      ok: true,
      detected: "application/rtf",
      declared: "text/rtf",
    });
  });

  it("accepts plain text uploads", async () => {
    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: Buffer.from("Client notes\nCourt date: Friday\n"),
        declared: "text/plain",
      })
    ).resolves.toMatchObject({ ok: true, detected: "text/plain" });
  });

  it("rejects binary content declared as plain text", async () => {
    await expect(
      checkMagicBytes({
        kind: "buffer",
        buf: Buffer.from([0x43, 0x00, 0x44]),
        declared: "text/plain",
      })
    ).resolves.toMatchObject({ ok: false, reason: "no_detection" });
  });
});
