"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  UploadCloud,
  FileText,
  X,
  CheckCircle,
  Loader2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { ALLOWED_CONTENT_TYPES, MAX_BYTES } from "@/lib/allowed-types";

const ALLOWED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.docx";
const MAX_FILES_PER_BATCH = 10;

interface TrackedFile {
  key: string;
  name: string;
  size: number;
  status: "pending" | "uploading" | "done" | "error";
  errorMessage?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LateUploadClient({ matterRef }: { matterRef: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileObjectsRef = useRef<Map<string, File>>(new Map());
  const keyCounterRef = useRef(0);
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [batchesDone, setBatchesDone] = useState(0);

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const isUploading = files.some((f) => f.status === "uploading");

  function validate(file: File): string | null {
    if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      return "Unsupported file type. Allowed: PDF, JPG, PNG, DOCX.";
    }
    if (file.size > MAX_BYTES) {
      return `File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit.`;
    }
    return null;
  }

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    setGlobalError(null);

    const next: TrackedFile[] = [];
    for (const file of Array.from(incoming).slice(0, MAX_FILES_PER_BATCH)) {
      const error = validate(file);
      keyCounterRef.current += 1;
      const key = `${file.name}:${file.size}:${file.lastModified}:${keyCounterRef.current}`;
      if (!error) fileObjectsRef.current.set(key, file);
      next.push({
        key,
        name: file.name,
        size: file.size,
        status: error ? "error" : "pending",
        errorMessage: error ?? undefined,
      });
    }
    setFiles((prev) => [...prev, ...next]);
  }

  function removeFile(key: string) {
    fileObjectsRef.current.delete(key);
    setFiles((prev) => prev.filter((f) => f.key !== key));
  }

  async function uploadOne(tracked: TrackedFile): Promise<void> {
    const file = fileObjectsRef.current.get(tracked.key);
    if (!file) return;

    setFiles((prev) =>
      prev.map((f) =>
        f.key === tracked.key ? { ...f, status: "uploading" } : f
      )
    );

    try {
      await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/late-upload/session",
        contentType: file.type,
      });
      setFiles((prev) =>
        prev.map((f) =>
          f.key === tracked.key ? { ...f, status: "done" } : f
        )
      );
      fileObjectsRef.current.delete(tracked.key);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      setFiles((prev) =>
        prev.map((f) =>
          f.key === tracked.key
            ? { ...f, status: "error", errorMessage: msg }
            : f
        )
      );
    }
  }

  async function handleUpload() {
    setGlobalError(null);
    const pending = files.filter((f) => f.status === "pending");
    await Promise.all(pending.map(uploadOne));
    setBatchesDone((n) => n + 1);
  }

  function startNewBatch() {
    setFiles([]);
    fileObjectsRef.current.clear();
    setGlobalError(null);
    inputRef.current?.focus();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    e.target.value = "";
  }

  const allDoneInBatch =
    files.length > 0 && files.every((f) => f.status === "done");

  return (
    <section
      aria-label="Upload your documents"
      className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4"
    >
      <div className="text-sm text-gray-600">
        Matter reference: <span className="font-mono text-gray-900">{matterRef}</span>
      </div>

      {batchesDone > 0 && files.length === 0 && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
          Thanks — your documents have been received. You can add more any time
          in the next 7 days using the same link from your email.
        </div>
      )}

      {!allDoneInBatch && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors min-h-[180px] flex flex-col items-center justify-center ${
            isDragging
              ? "border-brand bg-brand/5"
              : "border-gray-200 hover:border-brand/60 hover:bg-gray-50"
          }`}
        >
          <UploadCloud
            className="h-10 w-10 mb-3 text-gray-300"
            aria-hidden
          />
          <p className="text-sm text-gray-700">
            Drag &amp; drop files, or{" "}
            <span className="text-brand font-medium">browse</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            PDF, JPG, PNG, DOCX · max {MAX_BYTES / (1024 * 1024)} MB per file
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS}
            className="hidden"
            onChange={onInputChange}
          />
        </div>
      )}

      {files.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {files.map((f) => (
            <li
              key={f.key}
              className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              <span className="flex-1 truncate text-gray-800">{f.name}</span>
              <span className="text-xs text-gray-500 shrink-0">
                {formatSize(f.size)}
              </span>

              {f.status === "uploading" && (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-brand"
                  aria-label="Uploading"
                />
              )}
              {f.status === "done" && (
                <CheckCircle
                  className="h-4 w-4 shrink-0 text-green-600"
                  aria-label="Uploaded"
                />
              )}
              {f.status === "error" && (
                <AlertCircle
                  className="h-4 w-4 shrink-0 text-red-500"
                  aria-label="Failed"
                />
              )}
              {(f.status === "pending" || f.status === "error") && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(f.key);
                  }}
                  className="shrink-0 p-1 text-gray-400 hover:text-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.some((f) => f.status === "error" && f.errorMessage) && (
        <ul className="space-y-1" aria-live="polite">
          {files
            .filter((f) => f.status === "error" && f.errorMessage)
            .map((f) => (
              <li key={f.key} className="text-xs text-red-600">
                <strong>{f.name}:</strong> {f.errorMessage}
              </li>
            ))}
        </ul>
      )}

      {globalError && (
        <p className="text-sm text-amber-700" role="alert">
          {globalError}
        </p>
      )}

      <div className="flex gap-2">
        {pendingCount > 0 && !allDoneInBatch && (
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading}
            className="flex-1 min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Uploading…
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" aria-hidden />
                Upload {pendingCount} file{pendingCount !== 1 ? "s" : ""}
              </>
            )}
          </button>
        )}

        {allDoneInBatch && (
          <button
            type="button"
            onClick={startNewBatch}
            className="flex-1 min-h-[44px] px-4 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add more files
          </button>
        )}
      </div>
    </section>
  );
}
