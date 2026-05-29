// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ url: "https://blob.test/sample1.pdf" })),
}));

vi.mock("@vercel/blob/client", () => ({
  upload: mocks.upload,
}));

import { LateUploadClient } from "@/components/upload/late-upload-client";

describe("LateUploadClient", () => {
  it("requests Blob client tokens from a path that receives the upload cookie", async () => {
    const user = userEvent.setup();
    render(<LateUploadClient matterRef="s_test" clientName="Prabu" />);

    const input = document.querySelector("input[type='file']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    const file = new File(["%PDF-1.4\n"], "sample1.pdf", {
      type: "application/pdf",
    });
    await user.upload(input as HTMLInputElement, file);
    await user.click(
      screen.getByRole("button", { name: /submit documents/i })
    );

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload).toHaveBeenCalledWith(
      "sample1.pdf",
      file,
      expect.objectContaining({
        handleUploadUrl: "/upload/api/late-upload/session",
      })
    );
  });

  it("keeps the file picker wired after a file has been selected", async () => {
    const user = userEvent.setup();
    render(<LateUploadClient matterRef="s_test" clientName="Prabu" />);

    const input = document.querySelector("input[type='file']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await user.upload(
      input as HTMLInputElement,
      new File(["%PDF-1.4\n"], "sample1.pdf", { type: "application/pdf" })
    );

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    await user.click(screen.getByRole("button", { name: /add files/i }));

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("keeps submitted files visible while adding another batch", async () => {
    const user = userEvent.setup();
    render(<LateUploadClient matterRef="s_test" clientName="Prabu" />);

    const input = document.querySelector("input[type='file']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await user.upload(
      input as HTMLInputElement,
      new File(["%PDF-1.4\n"], "first.pdf", { type: "application/pdf" })
    );
    await user.click(
      screen.getByRole("button", { name: /submit documents/i })
    );

    await waitFor(() => expect(screen.getByText("first.pdf")).toBeVisible());

    await user.click(screen.getByRole("button", { name: /add more files/i }));
    await user.upload(
      input as HTMLInputElement,
      new File(["%PDF-1.4\n"], "second.pdf", { type: "application/pdf" })
    );

    expect(screen.getByText("first.pdf")).toBeVisible();
    expect(screen.getByText("second.pdf")).toBeVisible();
  });
});
