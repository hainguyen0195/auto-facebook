"use client";
import { useRef, useState } from "react";
import { api, useAction, type TaskRow } from "@/lib/client";
import { Field } from "./common";
import { Button } from "./ui/button";

export function PostLinkEditor({
  task,
}: {
  task: Pick<TaskRow, "id" | "version" | "resultUrl">;
}) {
  const [url, setUrl] = useState(task.resultUrl || "");
  const request = useRef<{
    operationId: string;
    version: number;
    resultUrl: string;
  } | null>(null);
  const save = useAction(
    (body: NonNullable<typeof request.current>) =>
      api(`tasks/${task.id}/link`, "PATCH", body),
    "Đã lưu link bài viết.",
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        request.current ||= {
          operationId: crypto.randomUUID(),
          version: task.version,
          resultUrl: url,
        };
        try {
          await save.mutateAsync(request.current);
          request.current = null;
        } catch {}
      }}
    >
      <Field
        label="Link bài đã đăng"
        hint="Dán permalink bài gốc. Lưu link không đổi trạng thái hoặc ngày ghi nhận đăng."
      >
        <input
          aria-label="Link bài đã đăng"
          required
          value={url}
          maxLength={2048}
          onChange={(e) => {
            setUrl(e.target.value);
            request.current = null;
          }}
          placeholder="https://www.facebook.com/groups/.../posts/..."
          disabled={save.isPending}
        />
      </Field>
      <Button type="submit" size="sm" loading={save.isPending}>
        Lưu link bài
      </Button>
      {save.error && (
        <p className="form-error" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
