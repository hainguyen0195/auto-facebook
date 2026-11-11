"use client";
import { Select } from "@/components/ui/select";
import { useState } from "react";
import { Download, History } from "lucide-react";
import { toast } from "sonner";
import {
  useDebounced,
  useResource,
  type AccountRow,
  type PageData,
  type TaskRow,
} from "@/lib/client";
import { STATUSES, STATUS_LABEL } from "@/lib/utils";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchBox,
  Skeleton,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { TaskTable } from "@/components/task-table";
import { TaskProcessor } from "@/components/task-processor";

export default function HistoryPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [status, setStatus] = useState("");
  const [accountId, setAccountId] = useState("");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState("");
  const [task, setTask] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const filters = new URLSearchParams({
    q,
    status,
    accountId,
    target,
    history: "true",
  }).toString();
  const query = useResource<PageData<TaskRow>>(`tasks?${filters}&page=${page}`);
  const accounts = useResource<AccountRow[]>("accounts");
  async function exportCsv() {
    setExporting(true);
    try {
      const response = await fetch(`/api/v1/tasks/export?${filters}`);
      if (!response.ok)
        throw new Error(
          (await response.json()).error || "Chưa xuất được dữ liệu.",
        );
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "nhip-dang-lich-su.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Đã xuất lịch sử theo bộ lọc hiện tại.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="RÕ KẾT QUẢ, DỄ ĐỐI CHIẾU"
        title="Lịch sử đăng bài"
        description="Những gì đã xử lý, những bài còn chờ duyệt và các ghi chú của bạn."
        actions={
          <Button
            variant="outline"
            onClick={exportCsv}
            loading={exporting}
            disabled={!query.data?.total}
          >
            <Download size={15} />
            Xuất CSV cho Excel
          </Button>
        }
      />
      <div className="toolbar">
        <div className="toolbar-left">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Tìm bài viết, nhóm, tài khoản…"
          />
          <Select
            aria-label="Lọc lịch sử theo tài khoản"
            value={accountId}
            onValueChange={(value) => {
              setAccountId(value);
              setPage(1);
            }}
          >
            <option value="">Tất cả tài khoản</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Lọc lịch sử theo trạng thái"
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <option value="">Tất cả kết quả</option>
            {STATUSES.filter((s) =>
              [
                "PUBLISHED",
                "PENDING_REVIEW",
                "SKIPPED",
                "BLOCKED",
                "CANCELLED",
              ].includes(s),
            ).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Lọc loại nơi đăng"
            value={target}
            onValueChange={(value) => {
              setTarget(value);
              setPage(1);
            }}
          >
            <option value="">Mọi nơi đăng</option>
            <option value="PROFILE">Trang cá nhân</option>
            <option value="GROUP">Hội nhóm</option>
          </Select>
        </div>
      </div>
      {query.isLoading ? (
        <Skeleton
          variant="table"
          columns={6}
          rows={6}
          label="Đang tải lịch sử đăng bài"
        />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <div className="panel">
          {query.data?.items.length ? (
            <>
              <TaskTable tasks={query.data.items} onOpen={setTask} history />
              <Pagination
                page={page}
                size={query.data.size}
                total={query.data.total}
                onChange={setPage}
              />
            </>
          ) : (
            <EmptyState
              title="Lịch sử sẽ bắt đầu từ bài đầu tiên"
              description="Khi bạn ghi nhận kết quả xử lý, thông tin sẽ được giữ lại ở đây. Thử thay đổi bộ lọc nếu cần."
              icon={<History size={29} strokeWidth={1.4} />}
            />
          )}
        </div>
      )}
      <div className="notice notice-teal" style={{ marginTop: 20 }}>
        <History size={17} />
        <p>
          Bài chờ quản trị viên duyệt chưa được tính là đã đăng. Bạn có thể mở
          “Chi tiết” để cập nhật kết quả và lưu link bài viết.
        </p>
      </div>
      <TaskProcessor id={task} onClose={() => setTask(null)} />
    </>
  );
}
