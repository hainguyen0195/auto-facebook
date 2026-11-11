"use client";
import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Field } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";

export function PasswordDialog() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LockKeyhole size={15} />
        Đổi mật khẩu
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!saving) {
            setOpen(value);
            setCurrent("");
            setNext("");
            setConfirm("");
            setError("");
          }
        }}
        title="Đổi mật khẩu ứng dụng"
        description="Đặt mật khẩu riêng cho Nhịp Đăng. Các phiên đăng nhập trên thiết bị khác sẽ được kết thúc."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (next.length < 12 || next.length > 128) {
              setError("Mật khẩu mới cần từ 12 đến 128 ký tự.");
              return;
            }
            if (next !== confirm) {
              setError("Hai lần nhập mật khẩu mới chưa khớp.");
              return;
            }
            setSaving(true);
            try {
              const result = await authClient.changePassword({
                currentPassword: current,
                newPassword: next,
                revokeOtherSessions: true,
              });
              if (result.error)
                throw new Error(
                  "Chưa thể đổi mật khẩu. Hãy kiểm tra mật khẩu hiện tại và thử lại.",
                );
              toast.success("Đã đổi mật khẩu ứng dụng.");
              setOpen(false);
              setCurrent("");
              setNext("");
              setConfirm("");
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label="Mật khẩu hiện tại" htmlFor="current-password">
            <input
              id="current-password"
              type="password"
              value={current}
              autoComplete="current-password"
              required
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="Mật khẩu mới" htmlFor="next-password">
            <input
              id="next-password"
              type="password"
              value={next}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Nhập lại mật khẩu mới" htmlFor="confirm-password">
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              autoComplete="new-password"
              required
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Hủy
            </Button>
            <Button type="submit" loading={saving}>
              Lưu mật khẩu mới
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
