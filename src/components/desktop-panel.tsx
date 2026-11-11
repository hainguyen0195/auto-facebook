"use client";
import { Select } from "@/components/ui/select";
import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Clipboard,
  Download,
  ExternalLink,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { api, useAction, useResource, type AccountRow } from "@/lib/client";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { ConfirmDialog, ErrorState, Field, Skeleton } from "./common";
import { formatDate, formatTime } from "@/lib/utils";

export type DesktopStatus = {
  localConnectAvailable?: boolean;
  windowsInstallerAvailable?: boolean;
  macosInstallerAvailable?: boolean;
  devices: {
    id: string;
    name: string;
    paused: boolean;
    online: boolean;
    lastSeenAt: string | null;
    supportsInbox?: boolean;
  }[];
  connections: {
    id: string;
    accountId: string;
    deviceId: string;
    state: string;
    automationEnabled: boolean;
    interactionEnabled: boolean;
    interactionDailyLimit: number;
    interactionIntervalMinutes: number;
    reviewRequired?: number;
    checkedAt: string | null;
    message: string;
  }[];
  commands: {
    id: string;
    accountId: string;
    kind: string;
    state: string;
    message: string;
    createdAt: string;
  }[];
};
const sessionLabel: Record<string, string> = {
  LOGIN_REQUIRED: "Cần đăng nhập Facebook",
  UNCONFIRMED: "Chờ bạn xác nhận đúng tài khoản",
  READY: "Đã kết nối Facebook",
  CHALLENGE: "Facebook yêu cầu xác minh",
  DISCONNECTED: "Đã ngắt kết nối",
  CHECKING: "Đang kiểm tra phiên trên máy được chọn",
  WRONG_IDENTITY: "Facebook không khớp tài khoản đã xác nhận",
};

export function FacebookControls({ account }: { account: AccountRow }) {
  const query = useResource<DesktopStatus>("desktop", {
    refetchInterval: 5_000,
  });
  const [selectedDevice, setSelectedDevice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(
    null,
  );
  const state = query.data;
  const connection = state?.connections.find((c) => c.accountId === account.id);
  const devices = state?.devices || [];
  const deviceId =
    devices.find((d) => d.id === selectedDevice)?.id ||
    devices.find((d) => d.id === connection?.deviceId)?.id ||
    devices.find((d) => d.online)?.id ||
    devices[0]?.id ||
    "";
  const device = devices.find((d) => d.id === deviceId);
  const activeDevice = devices.find((d) => d.id === connection?.deviceId);
  const differentDevice = !!connection && connection.deviceId !== deviceId;
  const command = state?.commands.find(
    (c) =>
      c.accountId === account.id && ["QUEUED", "RUNNING"].includes(c.state),
  );
  const lastCommand = state?.commands.find((c) => c.accountId === account.id);
  const failedCheck =
    connection?.state === "READY" &&
    lastCommand?.kind === "CHECK" &&
    lastCommand.state === "FAILED";
  const windowClosed =
    lastCommand?.kind === "CLOSE" && lastCommand.state === "SUCCEEDED";
  const commandAction = useAction(
    (kind: string) =>
      api("desktop/commands", "POST", {
        accountId: account.id,
        deviceId,
        kind,
      }),
    "Đã gửi yêu cầu tới máy đăng.",
  );
  const connectionAction = useAction(
    (action: string) =>
      api(`desktop/connections/${account.id}`, "PATCH", { action }),
    "Đã cập nhật kết nối Facebook.",
  );
  const localConnect = useAction(
    () => api("desktop/connect", "POST", { accountId: account.id }),
    "Đang khôi phục và kiểm tra phiên Facebook.",
  );
  const switchMachine = useAction(
    () => api(`desktop/connections/${account.id}/switch`, "POST", { deviceId }),
    "Đang chuyển máy và kiểm tra phiên Facebook đã lưu.",
  );
  const busy =
    switchMachine.isPending ||
    localConnect.isPending ||
    commandAction.isPending ||
    connectionAction.isPending ||
    !!command;
  const act = (kind: string) => commandAction.mutate(kind);
  if (query.isLoading)
    return (
      <div className="facebook-controls">
        <Skeleton variant="inline" rows={2} label="Đang tải kết nối Facebook" />
      </div>
    );
  if (query.error && !state)
    return (
      <div className="facebook-controls">
        <ErrorState error={query.error} retry={() => query.refetch()} />
      </div>
    );
  return (
    <div className="facebook-controls">
      <div className="desktop-status-line">
        <span
          className={`presence-dot ${activeDevice?.online && connection?.state === "READY" && !failedCheck ? "online" : ""}`}
        />
        <strong>
          {failedCheck
            ? "Chưa kiểm tra lại được phiên Facebook"
            : connection
              ? sessionLabel[connection.state] || connection.state
              : "Chưa kết nối Facebook"}
        </strong>
      </div>
      {activeDevice && (
        <p className="desktop-active-machine">
          Máy đang dùng: {activeDevice.name}
        </p>
      )}
      {failedCheck && connection.checkedAt && (
        <p className="field-hint">
          Xác nhận thành công lần cuối: {formatDate(connection.checkedAt)}{" "}
          {formatTime(connection.checkedAt)}
        </p>
      )}
      {devices.length || state?.localConnectAvailable ? (
        <>
          {devices.length > 0 && (
            <Select
              aria-label={`Máy đăng cho ${account.name}`}
              value={deviceId}
              onValueChange={(value) => setSelectedDevice(value)}
              disabled={busy || devices.length === 1}
            >
              <option value="">Chọn máy đăng</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.online ? " · online" : " · offline"}
                </option>
              ))}
            </Select>
          )}
          {devices.length === 1 && !state?.localConnectAvailable && (
            <p className="field-hint">
              Chỉ mới kết nối máy này.{" "}
              <Link href="/desktop#desktop-install-mac">
                Cài và ghép nối MacBook
              </Link>
              , sau đó chọn Mac trong danh sách để hiện nút Dùng máy này.
            </p>
          )}
          {device && (
            <p className="field-hint">
              {device?.name} ·{" "}
              {device?.online
                ? device.paused
                  ? "đang tạm dừng tự đăng"
                  : "đang trực tuyến"
                : "chưa trực tuyến"}
            </p>
          )}
          <div className="desktop-control-buttons">
            <Button
              size="sm"
              disabled={
                busy ||
                (differentDevice
                  ? !device?.online || !device?.supportsInbox
                  : !device?.online && !state?.localConnectAvailable)
              }
              loading={
                switchMachine.isPending ||
                localConnect.isPending ||
                (commandAction.isPending &&
                  ["LOGIN", "OPEN"].includes(commandAction.variables || ""))
              }
              onClick={() => {
                if (differentDevice) switchMachine.mutate();
                else if (!device?.online && state?.localConnectAvailable)
                  localConnect.mutate();
                else act(connection?.state === "READY" ? "OPEN" : "LOGIN");
              }}
            >
              <ExternalLink size={13} />
              {differentDevice
                ? "Dùng máy này"
                : connection?.state === "READY"
                  ? "Mở Facebook"
                  : "Kết nối Facebook"}
            </Button>
            {connection &&
              !differentDevice &&
              ["UNCONFIRMED", "READY", "WRONG_IDENTITY", "CHECKING"].includes(
                connection.state,
              ) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!device?.online || busy}
                  loading={
                    commandAction.isPending &&
                    commandAction.variables === "CHECK"
                  }
                  onClick={() => act("CHECK")}
                >
                  <RefreshCw size={13} />
                  Kiểm tra phiên
                </Button>
              )}
            {connection &&
              !differentDevice &&
              connection.state !== "DISCONNECTED" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!device?.online || busy}
                  loading={
                    commandAction.isPending &&
                    commandAction.variables === "CLOSE"
                  }
                  onClick={() => act("CLOSE")}
                >
                  Đóng cửa sổ
                </Button>
              )}
          </div>
          {differentDevice && !device?.supportsInbox && (
            <p className="field-hint">
              Cập nhật và khởi động lại runner trên máy được chọn trước khi
              chuyển máy.
            </p>
          )}
          {switchMachine.error && (
            <p className="field-error" role="alert">
              {switchMachine.error.message}
            </p>
          )}
          {(command || localConnect.isPending) && (
            <p className="field-hint" role="status">
              {localConnect.isPending
                ? "Đang khôi phục và kiểm tra phiên Facebook…"
                : command?.state === "QUEUED"
                  ? command.kind === "CLOSE"
                    ? "Đang chờ máy nhận yêu cầu đóng cửa sổ…"
                    : "Đang chờ máy nhận yêu cầu…"
                  : command?.kind === "CLOSE"
                    ? "Đang đóng cửa sổ Facebook…"
                    : command?.kind === "OPEN"
                      ? `Đang đưa cửa sổ Facebook lên trên máy ${device?.name || "đã kết nối"}…`
                      : command?.kind === "CHECK"
                        ? "Đang kiểm tra phiên Facebook…"
                        : "Đang khôi phục và kiểm tra phiên Facebook…"}
            </p>
          )}
          {localConnect.error && (
            <p className="field-error" role="alert">
              {localConnect.error.message}
            </p>
          )}
          {lastCommand?.state === "FAILED" && (
            <p className="field-error" role="alert">
              {lastCommand.message}
            </p>
          )}
          {lastCommand?.state === "SUCCEEDED" &&
            ["CLOSE", "OPEN_POST"].includes(lastCommand.kind) && (
              <p className="field-hint">
                {lastCommand.kind === "CLOSE"
                  ? "Đã đóng cửa sổ và dừng kiểm tra tin nhắn. Nếu vẫn bật tự đăng, lịch đến hạn có thể mở lại Facebook. Chọn Tạm dừng máy để dừng toàn bộ."
                  : lastCommand.message}
              </p>
            )}
          {device && !device.online && !command && (
            <>
              <p className="field-hint">
                {state?.localConnectAvailable
                  ? "Máy đăng đang ngoại tuyến. Bấm Mở Facebook hoặc Kết nối Facebook để bật lại trên máy này."
                  : "Máy đăng đang ngoại tuyến. Bật máy và kết nối mạng; ứng dụng nền sẽ tự kết nối lại."}
              </p>
              {!state?.localConnectAvailable && <DesktopReconnect />}
            </>
          )}
          {connection?.message &&
            !windowClosed &&
            lastCommand?.state !== "FAILED" && (
              <p className="field-hint">{connection.message}</p>
            )}
          {!!connection?.reviewRequired && (
            <p className="field-hint" role="status">
              {connection.automationEnabled ? "Đã giữ lựa chọn tự đăng. " : ""}
              Đang chờ kiểm tra {connection.reviewRequired} công việc. Mở{" "}
              <Link href="/calendar">Lịch đăng</Link> để ghi nhận kết quả; máy
              sẽ nhận lịch tiếp khi các công việc này đã được xử lý và tự đăng
              đang bật.
            </p>
          )}
          {connection &&
            !differentDevice &&
            ["LOGIN_REQUIRED", "CHALLENGE"].includes(connection.state) &&
            device?.online &&
            !windowClosed &&
            !command && (
              <>
                <p className="field-hint" role="status">
                  Đăng nhập và hoàn tất xác minh trong cửa sổ Facebook. Ứng dụng
                  tự kiểm tra trong 10 phút; sau đó bấm Kiểm tra lại nếu bạn
                  chưa xong.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!device?.online || busy}
                  onClick={() => act("CHECK")}
                >
                  <RefreshCw size={13} /> Kiểm tra lại
                </Button>
              </>
            )}
          {!differentDevice && connection?.state === "UNCONFIRMED" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              <Check size={13} />
              Xác nhận đúng tài khoản
            </Button>
          )}
          {!differentDevice && connection?.state === "READY" && (
            <label className="acknowledge">
              <input
                type="checkbox"
                checked={optimisticEnabled ?? connection.automationEnabled}
                disabled={
                  busy ||
                  (!connection.automationEnabled &&
                    (!device?.online || account.status !== "ACTIVE"))
                }
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setOptimisticEnabled(enabled);
                  try {
                    await connectionAction.mutateAsync(
                      enabled ? "enable" : "disable",
                    );
                  } catch {
                  } finally {
                    setOptimisticEnabled(null);
                  }
                }}
              />
              Cho phép tự đăng bài đã lên lịch
            </label>
          )}
          {connectionAction.isPending && (
            <p className="field-hint" role="status">
              Đang lưu lựa chọn…
            </p>
          )}
          {connection && !differentDevice && (
            <InteractionSettings
              key={`${connection.id}:${connection.interactionEnabled}:${connection.interactionDailyLimit}:${connection.interactionIntervalMinutes}`}
              accountId={account.id}
              connection={connection}
              busy={busy}
            />
          )}
        </>
      ) : (
        <p className="field-hint">
          {query.isLoading ? (
            "Đang tải kết nối…"
          ) : (
            <Link href="/desktop#desktop-install">
              Cài / kết nối lại máy đăng →
            </Link>
          )}
        </p>
      )}
      {query.error && <p className="field-error">{query.error.message}</p>}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Facebook đang mở đúng ${account.name}?`}
        description={`Trong cửa sổ vừa mở, kiểm tra tên, ảnh đại diện và trang cá nhân ${account.url}. Xác nhận này liên kết phiên Facebook trên máy với tài khoản trong ứng dụng.`}
        confirmLabel="Đúng tài khoản này"
        loading={connectionAction.isPending}
        onConfirm={async () => {
          try {
            await connectionAction.mutateAsync("confirm");
            setConfirm(false);
          } catch {}
        }}
      />
    </div>
  );
}

function DesktopReconnect() {
  return (
    <div className="field-hint">
      <Button asChild size="sm" variant="outline">
        <a href="nhipdang://start">
          <RefreshCw size={13} /> Kết nối lại
        </a>
      </Button>{" "}
      <Link href="/desktop#desktop-install">Cài ứng dụng nền lần đầu</Link>
      <p>
        Thao tác trên máy đã cài ứng dụng. Cho phép trình duyệt mở Nhịp Đăng nếu
        được hỏi.
      </p>
    </div>
  );
}

function InteractionSettings({
  accountId,
  connection,
  busy,
}: {
  accountId: string;
  connection: DesktopStatus["connections"][number];
  busy: boolean;
}) {
  const [enabled, setEnabled] = useState(connection.interactionEnabled);
  const [dailyLimit, setDailyLimit] = useState(
    connection.interactionDailyLimit || 10,
  );
  const [intervalMinutes, setInterval] = useState(
    connection.interactionIntervalMinutes || 5,
  );
  const save = useAction(
    () =>
      api(`desktop/interaction-settings/${accountId}`, "PATCH", {
        enabled,
        dailyLimit,
        intervalMinutes,
      }),
    "Đã lưu quyền và giới hạn tự tương tác.",
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      style={{ marginTop: 16 }}
    >
      <label className="acknowledge">
        <input
          type="checkbox"
          checked={enabled}
          disabled={
            busy || save.isPending || (connection.state !== "READY" && !enabled)
          }
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Cho phép tự tương tác
      </label>
      <p className="field-hint">
        Quyền riêng cho các công việc bạn đã duyệt, không thay đổi lựa chọn tự
        đăng. Giờ nghỉ của tài khoản vẫn áp dụng.
      </p>
      <div className="form-grid">
        <Field label="Tương tác tối đa/ngày">
          <input
            aria-label="Tương tác tối đa/ngày"
            type="number"
            min={1}
            max={100}
            required
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Number(e.target.value))}
          />
        </Field>
        <Field label="Cách nhau (phút)">
          <input
            aria-label="Khoảng cách tương tác (phút)"
            type="number"
            min={1}
            max={1440}
            required
            value={intervalMinutes}
            onChange={(e) => setInterval(Number(e.target.value))}
          />
        </Field>
      </div>
      <Button
        size="sm"
        variant="outline"
        type="submit"
        loading={save.isPending}
        disabled={busy}
      >
        Lưu cài đặt tương tác
      </Button>
      {save.error && (
        <p className="form-error" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

export function DesktopPanel() {
  const query = useResource<DesktopStatus>("desktop", {
    refetchInterval: 5_000,
  });
  const accounts = useResource<AccountRow[]>("accounts");
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
    server: string;
  } | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  const installer = useAction(() =>
    api<{ filename: string; content: string }>(
      "desktop/installer/windows",
      "POST",
      {},
    ),
  );
  const macInstaller = useAction(() =>
    api<{ filename: string; content: string }>(
      "desktop/installer/macos",
      "POST",
      {},
    ),
  );
  const pair = useAction(() =>
    api<{ code: string; expiresAt: string; server: string }>(
      "desktop/pairing",
      "POST",
      {},
    ),
  );
  const update = useAction(
    ({ id, action }: { id: string; action: string }) =>
      api(`desktop/devices/${id}`, "PATCH", { action }),
    "Đã cập nhật máy đăng.",
  );
  const command = pairing
    ? `npm run desktop -- --server "${pairing.server}" --code "${pairing.code}"`
    : "";
  return (
    <>
      <section className="panel desktop-intro">
        <div>
          <span className="eyebrow">KẾT NỐI MỘT LẦN, QUẢN LÝ TẬP TRUNG</span>
          <h2>Kết nối tài khoản Facebook</h2>
          <p>
            {query.data?.localConnectAvailable
              ? "Chọn tài khoản bên dưới, bấm Kết nối Facebook để khôi phục và kiểm tra phiên đã lưu. Chỉ cần đăng nhập và xác nhận ở lần đầu hoặc khi phiên không còn hợp lệ."
              : "Chọn tài khoản bên dưới để mở Facebook trên máy đã kết nối và dùng lại phiên đã lưu. Ứng dụng chỉ yêu cầu đăng nhập hoặc xác nhận khi cần."}
          </p>
        </div>
        {query.data?.localConnectAvailable && (
          <Button asChild>
            <a href="#desktop-accounts">Chọn tài khoản để kết nối</a>
          </Button>
        )}
        <Button
          variant="outline"
          loading={pair.isPending}
          onClick={async () => {
            try {
              setPairing(await pair.mutateAsync());
            } catch {}
          }}
        >
          <Monitor size={16} />
          {query.data?.localConnectAvailable
            ? "Kết nối máy khác"
            : "Kết nối máy mới (nâng cao)"}
        </Button>
      </section>
      {!query.data?.localConnectAvailable && (
        <section className="panel desktop-installer" id="desktop-install">
          <div className="desktop-installer-heading">
            <h2>Cài máy đăng</h2>
            <p>Cài một lần, tự kết nối khi đăng nhập máy.</p>
          </div>
          <div className="desktop-installer-options">
            <article className="desktop-installer-option">
              <div>
                <h3>Windows</h3>
                <p>Windows 10/11 · x64</p>
              </div>
              <Button
                size="sm"
                loading={installer.isPending}
                disabled={!query.data?.windowsInstallerAvailable}
                onClick={async () => {
                  try {
                    const file = await installer.mutateAsync();
                    const url = URL.createObjectURL(
                      new Blob([file.content], {
                        type: "application/octet-stream",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = file.filename;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1_000);
                    toast.info(
                      "Mở file Cai-Nhip-Dang.cmd vừa tải để cài một lần. Bộ cài có hiệu lực 15 phút; giữ kín file này.",
                    );
                  } catch {}
                }}
              >
                <Download size={16} /> Tải bộ cài Windows
              </Button>
              {!query.isLoading && !query.data?.windowsInstallerAvailable && (
                <p className="field-hint">
                  Bộ cài Windows chưa sẵn sàng. Vui lòng liên hệ quản trị viên.
                </p>
              )}
            </article>
            <article
              className="desktop-installer-option"
              id="desktop-install-mac"
            >
              <div>
                <h3>MacBook</h3>
                <p>macOS 14+ · Apple Silicon / Intel</p>
              </div>
              <Button
                size="sm"
                loading={macInstaller.isPending}
                disabled={!query.data?.macosInstallerAvailable}
                onClick={async () => {
                  try {
                    const file = await macInstaller.mutateAsync();
                    const bytes = Uint8Array.from(atob(file.content), (c) =>
                      c.charCodeAt(0),
                    );
                    const url = URL.createObjectURL(
                      new Blob([bytes], { type: "application/zip" }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = file.filename;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1_000);
                    toast.info(
                      "Giải nén và mở Cai-Nhip-Dang.command trên Mac. Bộ cài có hiệu lực 15 phút; giữ kín file này.",
                    );
                  } catch {}
                }}
              >
                <Download size={16} /> Tải bộ cài MacBook
              </Button>
              {!query.isLoading && !query.data?.macosInstallerAvailable && (
                <p className="field-hint">
                  Bộ cài MacBook chưa sẵn sàng. Vui lòng liên hệ quản trị viên.
                </p>
              )}
            </article>
          </div>
          <div className="desktop-installer-footer">
            <p>Bộ cài có hiệu lực 15 phút. Giữ kín file tải về.</p>
            <details>
              <summary>Hướng dẫn cài & chuyển máy</summary>
              <div className="desktop-installer-help">
                <p>
                  <strong>Windows:</strong> mở Cai-Nhip-Dang.cmd vừa tải.
                </p>
                <p>
                  <strong>MacBook:</strong> giải nén ZIP, mở
                  Cai-Nhip-Dang.command. Nếu macOS chặn, kiểm tra nguồn tải rồi
                  dùng tùy chọn Mở trong cài đặt bảo mật; không tắt Gatekeeper.
                </p>
                <p>
                  Cài xong, kéo xuống Các tài khoản của bạn, chọn máy mới trong
                  danh sách rồi bấm <strong>Dùng máy này</strong>. Đăng nhập
                  Facebook, xác nhận và bật quyền tự động ở lần đầu trên từng
                  máy.
                </p>
                <p>
                  Những lần sau chỉ cần dùng website. Máy cần bật, không ngủ và
                  có mạng. Nếu cần, bấm Kết nối lại trên máy đã cài; không cần
                  tải bộ cài mỗi ngày.
                </p>
                <p>
                  Đang dùng bản chạy thủ công? Tạm dừng máy và dừng runner cũ
                  trước khi cài. Phiên cũ vẫn được giữ trong thư mục cũ.
                </p>
              </div>
            </details>
          </div>
        </section>
      )}
      {query.isLoading ? (
        <Skeleton variant="devices" rows={2} label="Đang tải máy đăng" />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <div className="desktop-device-grid">
            {query.data?.devices.map((device) => (
              <section className="panel desktop-device" key={device.id}>
                <div className="desktop-status-line">
                  <Monitor size={19} />
                  <h3>{device.name}</h3>
                  <span
                    className={`presence-dot ${device.online ? "online" : ""}`}
                  />
                </div>
                <p>
                  {device.online ? "Đang trực tuyến" : "Chưa trực tuyến"} ·{" "}
                  {device.paused
                    ? "Tạm dừng tự đăng, tương tác và tin nhắn"
                    : device.online
                      ? "Sẵn sàng nhận lịch"
                      : "Chờ kết nối để nhận lịch"}
                </p>
                {device.online && !device.supportsInbox && (
                  <p className="field-hint">
                    Cần cập nhật runner để dùng Tin nhắn và chuyển máy.
                  </p>
                )}
                {device.lastSeenAt && (
                  <small>
                    Lần cuối: {formatDate(device.lastSeenAt)}{" "}
                    {formatTime(device.lastSeenAt)}
                  </small>
                )}
                <div className="desktop-control-buttons">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={update.isPending}
                    loading={
                      update.isPending && update.variables?.id === device.id
                    }
                    onClick={() =>
                      update.mutate({
                        id: device.id,
                        action: device.paused ? "resume" : "pause",
                      })
                    }
                  >
                    {device.paused ? <Play size={13} /> : <Pause size={13} />}
                    {device.paused ? "Tiếp tục" : "Tạm dừng"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={update.isPending}
                    onClick={() => setRevoke(device.id)}
                  >
                    <Unplug size={13} />
                    Ngắt kết nối
                  </Button>
                </div>
                {!device.online && !query.data?.localConnectAvailable && (
                  <DesktopReconnect />
                )}
              </section>
            ))}
          </div>
          {!query.data?.devices.length && (
            <div className="notice notice-teal">
              <Monitor size={18} />
              <p>
                {query.data?.localConnectAvailable
                  ? "Chưa có tài khoản Facebook nào được kết nối với máy này. Bấm Kết nối Facebook trên tài khoản bạn muốn dùng để bắt đầu."
                  : "Chưa có máy đang kết nối. Nếu đã bấm Ngắt kết nối, tải và mở lại bộ cài ở trên để ghép nối lại; không cần gỡ ứng dụng. Phiên Facebook trên máy vẫn được giữ."}
              </p>
              {!query.data?.localConnectAvailable && (
                <Button asChild size="sm" variant="outline">
                  <a href="#desktop-install">Cài / kết nối lại máy đăng</a>
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <div className="section-heading" id="desktop-accounts">
        <h2>Các tài khoản của bạn</h2>
        <Link href="/accounts">Quản lý tài khoản →</Link>
      </div>
      {accounts.isLoading ? (
        <Skeleton
          variant="cards"
          rows={3}
          label="Đang tải danh sách tài khoản"
        />
      ) : accounts.error ? (
        <ErrorState error={accounts.error} retry={() => accounts.refetch()} />
      ) : accounts.data?.length ? (
        <div className="account-grid">
          {accounts.data?.map((account) => (
            <section className="panel desktop-account" key={account.id}>
              <h3>{account.name}</h3>
              <p>{account.profileName}</p>
              <FacebookControls account={account} />
            </section>
          ))}
        </div>
      ) : (
        <div className="notice notice-amber">
          <p>Thêm tài khoản Facebook tại mục Tài khoản trước khi đăng nhập.</p>
        </div>
      )}
      <section className="panel desktop-notes">
        <h3>Đăng nhập và kiểm tra lần đầu</h3>
        <ol>
          <li>
            Bấm Kết nối Facebook trên tài khoản muốn dùng; tự nhập mật khẩu và
            2FA trong cửa sổ mở ra.
          </li>
          <li>
            Khi đăng nhập xong, ứng dụng tự kiểm tra phiên. Bấm Xác nhận đúng
            tài khoản để hoàn tất kết nối.
          </li>
          <li>
            Bật Cho phép tự đăng và chọn Tự đăng bằng máy đã kết nối khi lên
            lịch.
          </li>
        </ol>
        <p>
          Bấm Đăng thành công trên Facebook sẽ ghi nhận Đã đăng ngay, không chờ
          xác minh kết quả. Nhóm vẫn có thể yêu cầu quản trị viên duyệt bài. Máy
          tắt sẽ giữ lịch để xử lý khi kết nối lại. Tạm dừng không thu hồi bài
          đã gửi.
        </p>
      </section>
      <Modal
        open={!!pairing}
        onOpenChange={(value) => {
          if (!value) setPairing(null);
        }}
        title="Kết nối máy đăng"
        description="Mã dùng một lần, có hiệu lực 5 phút. Giữ kín lệnh này."
      >
        <p>
          Dùng Windows hoặc MacBook?{" "}
          <Link
            href="/desktop#desktop-install"
            onClick={() => setPairing(null)}
          >
            Tải bộ cài một lần
          </Link>{" "}
          để tự chạy nền. Lệnh bên dưới dành cho người dùng bản mã nguồn.
        </p>
        <p>
          Trong terminal tại thư mục Nhịp Đăng trên máy sẽ chạy Facebook, chạy:
        </p>
        <Field label="Lệnh kết nối" htmlFor="desktop-pair-command">
          <textarea
            id="desktop-pair-command"
            readOnly
            value={command}
            onFocus={(e) => e.target.select()}
          />
        </Field>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              toast.success("Đã sao chép lệnh kết nối.");
            } catch {
              toast.info("Chọn toàn bộ lệnh và nhấn Ctrl+C.");
            }
          }}
        >
          <Clipboard size={15} />
          Sao chép lệnh
        </Button>
        <p className="field-hint">
          Cần Node.js 24, mã nguồn và <code>npm ci</code>. Lần đầu cài trình
          duyệt bằng <code>npx playwright install chromium</code>. Không chạy
          máy đăng trên VPS không có giao diện.
        </p>
      </Modal>
      <ConfirmDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title="Ngắt kết nối máy đăng?"
        description="Thao tác này thu hồi khóa và xóa máy khỏi danh sách. Muốn kết nối lại, bạn phải tải và mở lại bộ cài trên máy đó. Phiên Facebook vẫn được giữ. Nếu chỉ muốn dừng nhận bài tạm thời, hãy dùng Tạm dừng."
        confirmLabel="Ngắt kết nối"
        loading={update.isPending}
        onConfirm={async () => {
          if (!revoke) return;
          try {
            await update.mutateAsync({ id: revoke, action: "revoke" });
            setRevoke(null);
          } catch {}
        }}
      />
    </>
  );
}
