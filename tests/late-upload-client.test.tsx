// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LateUploadClient } from "@/components/upload/late-upload-client";

describe("LateUploadClient", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true }))
    );
  });

  it("uploads through the same-origin late-upload route that receives the upload cookie", async () => {
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

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/upload/api/late-upload/session",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
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

  it("keeps the submit button visible after documents are submitted", async () => {
    const user = userEvent.setup();
    render(<LateUploadClient matterRef="s_test" clientName="Prabu" />);

    const input = document.querySelector("input[type='file']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await user.upload(
      input as HTMLInputElement,
      new File(["%PDF-1.4\n"], "submitted.pdf", { type: "application/pdf" })
    );
    await user.click(
      screen.getByRole("button", { name: /submit documents/i })
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /submit documents/i })
      ).toBeDisabled()
    );
    expect(
      screen.getByRole("button", { name: /add more files/i })
    ).toBeVisible();
  });

  it("shows the route error when upload fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "upload_failed" }, { status: 500 })
    );
    const user = userEvent.setup();
    render(<LateUploadClient matterRef="s_test" clientName="Prabu" />);

    const input = document.querySelector("input[type='file']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await user.upload(
      input as HTMLInputElement,
      new File(["%PDF-1.4\n"], "failed.pdf", { type: "application/pdf" })
    );
    await user.click(
      screen.getByRole("button", { name: /submit documents/i })
    );

    expect(await screen.findByText(/upload_failed/i)).toBeVisible();
    expect(screen.getByLabelText("Failed")).toBeVisible();
  });
});
