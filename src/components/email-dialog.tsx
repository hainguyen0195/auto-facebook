"use client";
import { useState } from "react";
import { Mail } from "lucide-react";
import { Field } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";

export function EmailDialog({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function reset(value: boolean) {
    if (saving) return;
    setOpen(value);
    setNext("");
    setPassword("");
    setError("");
  }
  return (
    <>
      <Button variant="outline" onClick={() => reset(true)} disabled={!email}>
        <Mail size={15} />
        Đổi email đăng nhập
      </Button>
      <Modal
        open={open}
        onOpenChange={reset}
        title="Đổi email đăng nhập"
        description="Đổi email của Nhịp Đăng. Sau khi lưu, mọi thiết bị cần đăng nhập lại bằng email mới và mật khẩu hiện tại."
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            if (next.trim().toLowerCase() === email.toLowerCase()) {
              setError("Hãy nhập email khác email hiện tại.");
              return;
            }
            setSaving(true);
            try {
              const response = await fetch("/api/auth/change-login-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  newEmail: next,
                  currentPassword: password,
                }),
              });
              const result = await response.json();
              if (response.status === 429)
                throw new Error(
                  "Bạn đã thử nhiều lần. Hãy chờ một phút rồi thử lại.",
                );
              if (!response.ok)
                throw new Error(
                  result.message || "Chưa thể đổi email. Hãy thử lại.",
                );
              window.location.assign("/login?emailChanged=1");
            } catch (error) {
              setError((error as Error).message);
              setSaving(false);
            }
          }}
        >
          <Field label="Email hiện tại" htmlFor="current-email">
            <input id="current-email" type="email" value={email} readOnly />
          </Field>
          <Field label="Email đăng nhập mới" htmlFor="next-email">
            <input
              id="next-email"
              type="email"
              value={next}
              autoComplete="email"
              maxLength={254}
              required
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>
          <Field label="Mật khẩu hiện tại" htmlFor="email-password">
            <input
              id="email-password"
              type="password"
              value={password}
              autoComplete="current-password"
              maxLength={128}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <p className="field-hint">
            Thông tin Facebook, bài viết và lịch đăng được giữ nguyên. Hiện ứng
            dụng chưa gửi email xác minh; hãy kiểm tra kỹ địa chỉ mới.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => reset(false)}
              disabled={saving}
            >
              Hủy
            </Button>
            <Button type="submit" loading={saving}>
              Lưu email mới
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
