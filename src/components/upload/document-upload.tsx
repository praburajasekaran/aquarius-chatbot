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

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    setGlobalError(null);

    const newFiles: UploadedFile[] = [];
    let slotsLeft = remaining;

    for (const file of Array.from(incoming)) {
      if (slotsLeft <= 0) break;
      const error = validateClientSide(file);
      newFiles.push({
        name: file.name,
        size: file.size,
        status: error ? "error" : "pending",
        errorMessage: error ?? undefined,
      });
      if (!error) slotsLeft--;
    }

    setFiles((prev) => [...prev, ...newFiles]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadAll() {
    const validFiles = files.filter((f) => f.status === "pending");
    if (validFiles.length === 0) return;

    // Get the actual File objects from the input (we need them for FormData)
    // Re-select all pending files
    const formData = new FormData();
    formData.append("sessionId", sessionId);

    // Mark all pending as uploading
    setFiles((prev) =>
      prev.map((f) => (f.status === "pending" ? { ...f, status: "uploading" } : f))
    );

    // We need to re-read the files from input. Instead, let's track File objects.
    // This component stores File objects separately.
    // NOTE: see fileObjectsRef below — refactored to store File objects.
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

  async function handleUpload() {
    const pendingFiles: File[] = [];
    for (const f of files) {
      if (f.status !== "pending") continue;
      const key = `${f.name}-${f.size}`;
      // Find matching File object
      for (const [k, file] of fileObjectsRef.current.entries()) {
        if (k.startsWith(key)) {
          pendingFiles.push(file);
          break;
        }
      }
    }

    if (pendingFiles.length === 0) return;

    setGlobalError(null);

    // Mark all pending as uploading
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
        // Map per-file errors back
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
          // Global error
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

      // Success — mark uploading as done, apply any per-file errors
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
    // Reset input so same file can be re-added after removal
    e.target.value = "";
  }

  async function handleContinue() {
    setSubmitted(true);
    const doneCount = files.filter((f) => f.status === "done").length;
    onComplete(doneCount);
  }

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <div className="mx-11 p-4 bg-white border border-gray-200 rounded-xl shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <UploadCloud className="h-4 w-4 text-brand" />
        Upload Supporting Documents
      </div>

      <p className="text-xs text-gray-500">
        Attach relevant documents (charge sheets, court notices, photos). Optional
        — you can skip if you have none. PDF, JPG, PNG, DOCX · max 10MB each ·
        up to {MAX_FILES} files.
      </p>

      {/* Drop zone */}
      {!submitted && remaining > 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-brand bg-brand/5"
              : "border-gray-200 hover:border-brand/60 hover:bg-gray-50"
          }`}
        >
          <UploadCloud className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500">
            Drag & drop files here, or{" "}
            <span className="text-brand font-medium">browse</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {remaining} slot{remaining !== 1 ? "s" : ""} remaining
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS}
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="flex-1 truncate text-gray-700">{f.name}</span>
              <span className="text-gray-400 shrink-0">{formatSize(f.size)}</span>

              {f.status === "uploading" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
              )}
              {f.status === "done" && (
                <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
              )}
              {f.status === "error" && (
                <span
                  title={f.errorMessage}
                  className="flex items-center gap-1 text-red-500 shrink-0"
                >
                  <AlertCircle className="h-4 w-4" />
                </span>
              )}
              {(f.status === "pending" || f.status === "error") && !submitted && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                  aria-label="Remove file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Per-file error messages */}
      {files.some((f) => f.status === "error" && f.errorMessage) && (
        <ul className="space-y-0.5">
          {files
            .filter((f) => f.status === "error" && f.errorMessage)
            .map((f, i) => (
              <li key={i} className="text-xs text-red-600">
                <strong>{f.name}:</strong> {f.errorMessage}
              </li>
            ))}
        </ul>
      )}

      {globalError && (
        <p className="text-xs text-amber-600">{globalError}</p>
      )}

      {/* Actions */}
      {!submitted && (
        <div className="flex gap-2 pt-1">
          {pendingCount > 0 && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex-1 py-2 px-4 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4" />
                  Upload {pendingCount} file{pendingCount !== 1 ? "s" : ""}
                </>
              )}
            </button>
          )}

          {(allDone || doneCount > 0) && pendingCount === 0 && !isUploading && (
            <button
              onClick={handleContinue}
              className="flex-1 py-2 px-4 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              Continue
            </button>
          )}

          {pendingCount === 0 && !isUploading && doneCount === 0 && (
            <button
              onClick={onSkip}
              className="flex-1 py-2 px-4 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Skip — no documents
            </button>
          )}
        </div>
      )}

      {submitted && (
        <div className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
          {doneCount > 0
            ? `${doneCount} document${doneCount !== 1 ? "s" : ""} uploaded successfully.`
            : "No documents uploaded."}
        </div>
      )}
    </div>
  );
}
