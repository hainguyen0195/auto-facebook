"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  FileText,
  Layers3,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Brand } from "@/components/app-shell";
import { standaloneMode } from "@/lib/mobile-app-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/common";

type LoginValues = { email: string; password: string };
export default function LoginPage() {
  const [emailChanged, setEmailChanged] = useState(false);
  useEffect(() => {
    setEmailChanged(
      new URLSearchParams(window.location.search).get("emailChanged") === "1",
    );
  }, []);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>();
  const submit = handleSubmit(async (values) => {
    setError("");
    try {
      const result = await authClient.signIn.email(values);
      if (result.error) {
        setError(
          result.error.status === 429
            ? "Bạn đã thử nhiều lần. Hãy chờ một phút rồi thử lại."
            : "Email hoặc mật khẩu chưa đúng. Hãy kiểm tra lại.",
        );
        return;
      }
      window.location.assign(standaloneMode() ? "/inbox" : "/");
    } catch {
      setError("Chưa kết nối được ứng dụng. Hãy kiểm tra mạng và thử lại.");
    }
  });
  return (
    <main className="login-page">
      <section className="login-form-side">
        <Brand />
        <div className="login-form-wrap animate-enter">
          <div className="eyebrow">
            <span />
            GÓC LÀM VIỆC CỦA BẠN
          </div>
          <h1>
            Chào bạn,
            <br />
            mình bắt đầu nhé<span>.</span>
          </h1>
          <p>Đăng nhập để sắp xếp nội dung và giữ nhịp bán hàng mỗi ngày.</p>
          <form onSubmit={submit} noValidate>
            {emailChanged && (
              <p className="notice notice-teal" role="status">
                Đã đổi email. Đăng nhập bằng email mới và mật khẩu hiện tại.
              </p>
            )}
            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="ban@example.com"
                {...register("email", {
                  required: "Nhập email của bạn.",
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: "Email chưa hợp lệ.",
                  },
                })}
              />
            </Field>
            <Field
              label="Mật khẩu"
              htmlFor="password"
              error={errors.password?.message}
            >
              <div className="password-input">
                <input
                  id="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Mật khẩu ứng dụng"
                  {...register("password", {
                    required: "Nhập mật khẩu của bạn.",
                  })}
                />
                <button
                  type="button"
                  aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              loading={isSubmitting}
              className="login-submit"
            >
              Vào góc làm việc <ArrowRight size={18} />
            </Button>
          </form>
          <div className="login-note">
            <LockKeyhole size={15} />
            <span>
              Đăng nhập bằng tài khoản ứng dụng.
              <br />
              Facebook được đăng nhập riêng trong trình duyệt.
            </span>
          </div>
          <p className="invite-note">
            Chưa có tài khoản? Liên hệ người quản trị để được mời.
          </p>
        </div>
        <small className="login-copyright">
          NHỊP ĐĂNG · LÀM VIỆC NHẸ NHÀNG HƠN
        </small>
      </section>
      <section className="login-story">
        <div className="story-orbit orbit-one" />
        <div className="story-orbit orbit-two" />
        <div className="story-top">
          <span className="story-pill">
            <span />
            ĐỀU NHỊP. RÕ VIỆC.
          </span>
          <Layers3 size={27} strokeWidth={1.3} />
        </div>
        <div className="story-content">
          <h2>
            Một ngày bán hàng,
            <br />
            <em>gọn hơn.</em>
          </h2>
          <p>Từ ý tưởng đến bài đăng, mọi thứ đều có chỗ của mình.</p>
          <div className="story-workflow">
            <div>
              <span className="story-step">
                <FileText size={21} />
              </span>
              <div>
                <small>BƯỚC 01</small>
                <strong>Chuẩn bị nội dung</strong>
                <p>Bài viết và hình ảnh, sẵn trong một nơi.</p>
              </div>
              <Check size={17} />
            </div>
            <div>
              <span className="story-step">
                <CalendarDays size={21} />
              </span>
              <div>
                <small>BƯỚC 02</small>
                <strong>Sắp xếp lịch của bạn</strong>
                <p>Đúng tài khoản, đúng nhóm, đúng lúc.</p>
              </div>
              <Check size={17} />
            </div>
            <div>
              <span className="story-step step-bright">
                <ArrowRight size={22} />
              </span>
              <div>
                <small>BƯỚC 03</small>
                <strong>Kiểm tra và đăng bài</strong>
                <p>Bạn giữ quyền quyết định ở bước cuối.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="story-bottom">
          <ShieldCheck size={19} />
          <span>Không gian riêng. Dữ liệu riêng. Nhịp làm việc của bạn.</span>
        </div>
      </section>
    </main>
  );
}
