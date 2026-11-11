"use client";
import { ErrorState } from "@/components/common";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="standalone-error">
      <ErrorState
        error={new Error("Ứng dụng đang gặp sự cố. Hãy thử lại sau ít phút.")}
        retry={reset}
      />
    </main>
  );
}
