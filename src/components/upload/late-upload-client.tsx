"use client";

import { useRef, useState } from "react";
import {
  UploadCloud,
  FileText,
  X,
  CheckCircle,
  Loader2,
  AlertCircle,
  Plus,
} from "lucide-react";
import {
  MAX_BYTES,
  formatUploadLimit,
  resolveUploadContentType,
} from "@/lib/allowed-types";

const ALLOWED_EXTENSIONS = ".pdf,.jpg,.jpeg,.heic,.heif,.png,.doc,.docx,.rtf,.txt";
const ALLOWED_TYPES_LABEL = "PDF, JPG, HEIC/HEIF, PNG, DOC, DOCX, RTF, TXT";
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

export function LateUploadClient({
  matterRef,
  clientName,
}: {
  matterRef: string;
  clientName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileObjectsRef = useRef<Map<string, File>>(new Map());
  const keyCounterRef = useRef(0);
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<TrackedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const isUploading = files.some((f) => f.status === "uploading");
  const submittedCount = uploadedFiles.length;

  function validate(file: File): string | null {
    if (!resolveUploadContentType(file.type, file.name)) {
      return `Unsupported file type. Allowed: ${ALLOWED_TYPES_LABEL}.`;
    }
    if (file.size > MAX_BYTES) {
      return `File exceeds ${formatUploadLimit()} limit.`;
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
    const contentType = resolveUploadContentType(file.type, file.name);
    if (!contentType) return;

    setFiles((prev) =>
      prev.map((f) =>
        f.key === tracked.key ? { ...f, status: "uploading" } : f
      )
    );

    try {
      const formData = new FormData();
      formData.append("file", file, file.name);

      const res = await fetch("/upload/api/late-upload/session", {
        method: "POST",
        body: formData,
      });
      const data = await parseUploadResponse(res);
      if (!res.ok) {
        throw new Error(data.error ?? "Upload failed. Please try again.");
      }

      setFiles((prev) => prev.filter((f) => f.key !== tracked.key));
      setUploadedFiles((prev) => [
        ...prev,
        { ...tracked, status: "done", errorMessage: undefined },
      ]);
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
  }

  function startNewBatch() {
    setFiles([]);
    fileObjectsRef.current.clear();
    setGlobalError(null);
    inputRef.current?.click();
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

  return (
    <section
      aria-label="Upload your documents"
      className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4"
    >
      {clientName && (
        <div className="text-base text-gray-900">
          Hi <span className="font-medium">{clientName}</span>, please upload
          any documents for your matter below.
        </div>
      )}
      <div className="text-sm text-gray-600">
        Matter reference: <span className="font-mono text-gray-900">{matterRef}</span>
      </div>

      {submittedCount > 0 && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
          <p className="font-medium">Documents submitted</p>
          <p className="mt-1">
            We received {submittedCount} file{submittedCount !== 1 ? "s" : ""}.
            You can add more any time in the next 7 days using the same link
            from your email.
          </p>
        </div>
      )}

      {files.length === 0 && uploadedFiles.length === 0 && (
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
            {ALLOWED_TYPES_LABEL} · max {formatUploadLimit()} per file
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS}
        className="hidden"
        onChange={onInputChange}
      />

      {uploadedFiles.length > 0 && (
        <FileList
          files={uploadedFiles}
          ariaLabel="Uploaded files"
        />
      )}

      {files.length > 0 && (
        <FileList
          files={files}
          ariaLabel="Files ready to submit"
          onRemove={removeFile}
        />
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

      <div className="flex flex-col gap-2 sm:flex-row">
        {pendingCount > 0 && (
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
                <CheckCircle className="h-4 w-4" aria-hidden />
                Submit documents
              </>
            )}
          </button>
        )}

        {files.length > 0 && pendingCount > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className="min-h-[44px] px-4 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add files
          </button>
        )}

        {uploadedFiles.length > 0 && pendingCount === 0 && !isUploading && (
          <>
            <button
              type="button"
              disabled
              className="flex-1 min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium opacity-80 flex items-center justify-center gap-2"
            >
              <CheckCircle className="h-4 w-4" aria-hidden />
              Submit documents
            </button>

            <button
              type="button"
              onClick={startNewBatch}
              className="flex-1 min-h-[44px] px-4 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add more files
            </button>
          </>
        )}
      </div>
    </section>
  );
}

async function parseUploadResponse(
  res: Response
): Promise<{ error?: string }> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return {};
  }
}

function FileList({
  files,
  ariaLabel,
  onRemove,
}: {
  files: TrackedFile[];
  ariaLabel: string;
  onRemove?: (key: string) => void;
}) {
  return (
    <ul className="space-y-2" aria-label={ariaLabel} aria-live="polite">
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
          {onRemove && (f.status === "pending" || f.status === "error") && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(f.key);
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
  );
}
