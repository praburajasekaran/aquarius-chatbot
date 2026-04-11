"use client";

import { useRef, useState } from "react";
import {
  UploadCloud,
  FileText,
  X,
  CheckCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";

const MAX_FILES = 5;
const MAX_SIZE_MB = 10;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const ALLOWED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.docx";

interface UploadedFile {
  name: string;
  size: number;
  status: "pending" | "uploading" | "done" | "error";
  errorMessage?: string;
}

interface DocumentUploadProps {
  sessionId: string;
  alreadyUploaded?: number;
  onComplete: (uploaded: number) => void;
  onSkip: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentUpload({
  sessionId,
  alreadyUploaded = 0,
  onComplete,
  onSkip,
}: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const remaining = MAX_FILES - alreadyUploaded - files.length;
  const isUploading = files.some((f) => f.status === "uploading");
  const allDone = files.length > 0 && files.every((f) => f.status === "done");

  function validateClientSide(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Invalid file type. Allowed: PDF, JPG, PNG, DOCX";
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `File exceeds ${MAX_SIZE_MB}MB limit`;
    }
    return null;
  }

  // Store actual File objects alongside metadata
  const fileObjectsRef = useRef<Map<string, File>>(new Map());

  function addFilesWithObjects(incoming: FileList | null) {
    if (!incoming) return;
    setGlobalError(null);

    const newFiles: UploadedFile[] = [];
    let slotsLeft = remaining;

    for (const file of Array.from(incoming)) {
      if (slotsLeft <= 0) {
        setGlobalError(`Maximum ${MAX_FILES} files allowed. Some files were not added.`);
        break;
      }
      const error = validateClientSide(file);
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (!error) {
        fileObjectsRef.current.set(key, file);
        slotsLeft--;
      }
      newFiles.push({
        name: file.name,
        size: file.size,
        status: error ? "error" : "pending",
        errorMessage: error ?? undefined,
      });
    }

    setFiles((prev) => [...prev, ...newFiles]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    const pendingFiles: File[] = [];
    for (const f of files) {
      if (f.status !== "pending") continue;
      const key = `${f.name}-${f.size}`;
      for (const [k, file] of fileObjectsRef.current.entries()) {
        if (k.startsWith(key)) {
          pendingFiles.push(file);
          break;
        }
      }
    }

    if (pendingFiles.length === 0) return;

    setGlobalError(null);

    setFiles((prev) =>
      prev.map((f) => (f.status === "pending" ? { ...f, status: "uploading" } : f))
    );

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    for (const file of pendingFiles) {
      formData.append("files", file);
    }

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.errors && Array.isArray(data.errors)) {
          const errorMap = new Map<string, string>(
            data.errors.map((e: { name: string; reason: string }) => [e.name, e.reason])
          );
          setFiles((prev) =>
            prev.map((f) => {
              if (f.status === "uploading") {
                const reason = errorMap.get(f.name);
                return reason
                  ? { ...f, status: "error", errorMessage: reason }
                  : { ...f, status: "error", errorMessage: "Upload failed" };
              }
              return f;
            })
          );
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.status === "uploading"
                ? { ...f, status: "error", errorMessage: data.error ?? "Upload failed" }
                : f
            )
          );
          setGlobalError(data.error ?? "Upload failed. Please try again.");
        }
        return;
      }

      const errorMap = new Map<string, string>(
        (data.errors ?? []).map((e: { name: string; reason: string }) => [e.name, e.reason])
      );

      setFiles((prev) =>
        prev.map((f) => {
          if (f.status !== "uploading") return f;
          const reason = errorMap.get(f.name);
          return reason
            ? { ...f, status: "error", errorMessage: reason }
            : { ...f, status: "done" };
        })
      );

      if (data.warning) {
        setGlobalError(data.warning);
      }
    } catch {
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "uploading"
            ? { ...f, status: "error", errorMessage: "Network error, please retry" }
            : f
        )
      );
      setGlobalError("Upload failed due to a network error. Please try again.");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    addFilesWithObjects(e.dataTransfer.files);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFilesWithObjects(e.target.files);
    e.target.value = "";
  }

  function handleDropZoneKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  async function handleContinue() {
    setSubmitted(true);
    const doneCount = files.filter((f) => f.status === "done").length;
    onComplete(doneCount);
  }

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <section aria-label="Upload supporting documents" className="mx-11 p-4 bg-white border border-gray-200 rounded-xl shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-base font-medium text-gray-800">
        <UploadCloud className="h-4 w-4 text-brand" aria-hidden="true" />
        Upload Supporting Documents
      </div>

      {/* text-sm secondary text; gray-700 = 10.31:1 AAA */}
      <p className="text-sm text-gray-700">
        Attach relevant documents (charge sheets, court notices, photos). Optional
        — you can skip if you have none. PDF, JPG, PNG, DOCX · max 10MB each ·
        up to {MAX_FILES} files.
      </p>

      {/* Drop zone — keyboard accessible via role="button" + tabIndex */}
      {!submitted && remaining > 0 && (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Upload files. ${remaining} slot${remaining !== 1 ? "s" : ""} remaining. Click or press Enter to browse.`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={handleDropZoneKeyDown}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-[#085a66] bg-brand/5"
              : "border-gray-200 hover:border-[#085a66]/60 hover:bg-gray-50"
          }`}
        >
          <UploadCloud className="h-8 w-8 mx-auto mb-2 text-gray-400" aria-hidden="true" />
          <p className="text-base text-gray-700">
            Drag &amp; drop files here, or{" "}
            <span className="text-[#085a66] font-medium">browse</span>
          </p>
          {/* Secondary label — text-sm, gray-700 = AAA */}
          <p className="text-sm text-gray-700 mt-1" aria-hidden="true">
            {remaining} slot{remaining !== 1 ? "s" : ""} remaining
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS}
            aria-label="Select files to upload"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <ul aria-label="Selected files" className="space-y-1.5">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-gray-600" aria-hidden="true" />
              <span className="flex-1 truncate text-gray-800">{f.name}</span>
              {/* gray-700 on white = 10.31:1 AAA */}
              <span className="text-gray-700 shrink-0">{formatSize(f.size)}</span>

              {f.status === "uploading" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-label="Uploading" />
              )}
              {f.status === "done" && (
                <CheckCircle className="h-4 w-4 shrink-0 text-green-700" aria-label="Upload complete" />
              )}
              {f.status === "error" && (
                <span
                  title={f.errorMessage}
                  className="flex items-center gap-1 text-red-800 shrink-0"
                  aria-label={`Error: ${f.errorMessage}`}
                >
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              {(f.status === "pending" || f.status === "error") && !submitted && (
                /* min-h-[44px] touch target — WCAG 2.5.5 AAA */
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  aria-label={`Remove ${f.name}`}
                  className="text-gray-600 hover:text-gray-800 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Per-file error messages — role="alert" for immediate announcement */}
      {files.some((f) => f.status === "error" && f.errorMessage) && (
        <ul role="alert" aria-label="File errors" className="space-y-0.5">
          {files
            .filter((f) => f.status === "error" && f.errorMessage)
            .map((f, i) => (
              <li key={i} className="text-sm text-red-800">
                <strong>{f.name}:</strong> {f.errorMessage}
              </li>
            ))}
        </ul>
      )}

      {globalError && (
        <p role="alert" className="text-sm text-amber-900">{globalError}</p>
      )}

      {/* Actions — min-h-[44px] on all buttons for AAA touch targets */}
      {!submitted && (
        <div className="flex gap-2 pt-1">
          {pendingCount > 0 && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex-1 min-h-[44px] py-2 px-4 rounded-lg bg-[#085a66] text-white text-base font-medium hover:bg-[#064550] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Uploading…</span>
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4" aria-hidden="true" />
                  <span>Upload {pendingCount} file{pendingCount !== 1 ? "s" : ""}</span>
                </>
              )}
            </button>
          )}

          {(allDone || doneCount > 0) && pendingCount === 0 && !isUploading && (
            <button
              onClick={handleContinue}
              className="flex-1 min-h-[44px] py-2 px-4 rounded-lg bg-[#085a66] text-white text-base font-medium hover:bg-[#064550] transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              <span>Continue</span>
            </button>
          )}

          {pendingCount === 0 && !isUploading && doneCount === 0 && (
            <button
              onClick={onSkip}
              className="flex-1 min-h-[44px] py-2 px-4 rounded-lg border border-gray-400 text-gray-800 text-base font-medium hover:bg-gray-50 transition-colors"
            >
              Skip — no documents
            </button>
          )}
        </div>
      )}

      {submitted && (
        <div role="status" className="text-sm text-green-900 bg-green-50 rounded-lg px-3 py-2">
          {doneCount > 0
            ? `${doneCount} document${doneCount !== 1 ? "s" : ""} uploaded successfully.`
            : "No documents uploaded."}
        </div>
      )}
    </section>
  );
}
