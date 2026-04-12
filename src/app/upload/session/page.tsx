import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { verifyCookie, COOKIE_NAME } from "@/lib/upload-session";
import { LateUploadClient } from "@/components/upload/late-upload-client";
import { BRANDING } from "@/lib/branding";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Upload your documents — ${BRANDING.firmName}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function Page() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  const session = verifyCookie(raw);
  if (!session) notFound();

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto">
        <header className="mb-6">
          <h1 className="font-rubik text-2xl font-semibold text-gray-900">
            Upload your documents
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Files uploaded here are sent securely to {BRANDING.firmName} and stored
            in our case-management system. See our{" "}
            <a
              href={BRANDING.privacyUrl}
              className="text-brand underline"
              rel="noreferrer"
            >
              Privacy Policy
            </a>
            .
          </p>
        </header>

        <LateUploadClient matterRef={session.matterRef} />
      </div>
    </main>
  );
}
