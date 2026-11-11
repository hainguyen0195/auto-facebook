"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import {
  api,
  useAction,
  useDebounced,
  useResource,
  type PageData,
  type PostRow,
} from "@/lib/client";
import { assetUrl, formatDate } from "@/lib/utils";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchBox,
  Skeleton,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { PostComposer } from "@/components/post-composer";
import { ScheduleDialog } from "@/components/schedule-dialog";
import {
  PostScheduleSummary,
  PostScheduleDetails,
  type PostScheduleSelection,
} from "@/components/post-schedule-summary";
import { TaskProcessor } from "@/components/task-processor";

export default function PostsPage() {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const query = useResource<PageData<PostRow>>(
    `posts?page=${page}&size=9&q=${encodeURIComponent(q)}`,
    { refetchInterval: 30_000 },
  );
  const [editor, setEditor] = useState<PostRow | "new" | null>(null);
  const [schedule, setSchedule] = useState<PostRow | null>(null);
  const [scheduleDetails, setScheduleDetails] =
    useState<PostScheduleSelection | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostRow | null>(null);
  useEffect(() => {
    if (params.get("new") === "1") setEditor("new");
  }, [params]);
  useEffect(() => {
    if (!query.data || query.isFetching) return;
    const lastPage = Math.max(1, Math.ceil(query.data.total / query.data.size));
    if (page > lastPage) setPage(lastPage);
  }, [query.data, query.isFetching, page]);
  const remove = useAction(
    (id: string) => api(`posts/${id}`, "DELETE"),
    "Đã xóa bài khỏi thư viện. Các lịch đã tạo vẫn được giữ nguyên.",
  );
  return (
    <>
      <PageHeader
        eyebrow="CHUẨN BỊ TỐT, ĐĂNG NHẸ NHÀNG"
        title="Thư viện bài viết"
        description="Nội dung, hình ảnh và những ý tưởng bạn muốn gửi tới khách hàng."
        actions={
          <Button onClick={() => setEditor("new")}>
            <Plus size={16} />
            Soạn bài mới
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
            placeholder="Tìm tiêu đề, nội dung, nhãn…"
          />
        </div>
        <span className="results-count">
          {query.isLoading
            ? "Đang tải…"
            : query.error
              ? "Chưa tải được dữ liệu"
              : `${query.data?.total || 0} bài trong thư viện`}
        </span>
      </div>
      {query.isLoading ? (
        <Skeleton variant="posts" rows={3} label="Đang tải thư viện bài viết" />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : query.data?.items.length ? (
        <>
          <div className="post-grid">
            {query.data.items.map((post) => (
              <article className="panel post-card animate-enter" key={post.id}>
                <div className="post-cover">
                  {post.assets.length ? (
                    <img
                      src={assetUrl(post.assets[0].assetId)}
                      alt={post.title}
                    />
                  ) : (
                    <FileText size={43} strokeWidth={1} />
                  )}
                  {post.assets.length > 0 && (
                    <span className="post-cover-count">
                      {post.assets.length} ảnh
                    </span>
                  )}
                </div>
                <div className="post-body">
                  <h3>
                    <button
                      type="button"
                      className="title-button"
                      onClick={() => setEditor(post)}
                      title="Chỉnh sửa bài viết"
                    >
                      {post.title}
                    </button>
                  </h3>
                  <p className="post-excerpt">{post.content}</p>
                  {post.tags.length > 0 && (
                    <div className="post-tags">
                      {post.tags.map((tag) => (
                        <span className="tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <PostScheduleSummary post={post} onOpen={setScheduleDetails} />
                <div className="post-card-footer">
                  <span>Sửa {formatDate(post.updatedAt)}</span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label={`Chỉnh sửa ${post.title}`}
                      onClick={() => setEditor(post)}
                    >
                      <Pencil size={14} />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="post-delete-button"
                      aria-label={`Xóa bài ${post.title}`}
                      onClick={() => setDeleteTarget(post)}
                    >
                      <Trash2 size={14} />
                      Xóa
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSchedule(post)}
                    >
                      <CalendarPlus size={13} />
                      Lên lịch
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            page={page}
            size={query.data.size}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      ) : (
        <div className="panel">
          <EmptyState
            title={
              search
                ? "Chưa tìm thấy bài phù hợp"
                : "Ý tưởng đầu tiên bắt đầu ở đây"
            }
            description={
              search
                ? "Thử tìm bằng một từ khóa hoặc nhãn khác."
                : "Viết một bài, thêm ảnh và lưu lại để lên lịch cho nhiều nơi đăng."
            }
            icon={<FileText size={30} strokeWidth={1.4} />}
            action={
              !search && (
                <Button variant="secondary" onClick={() => setEditor("new")}>
                  <Plus size={15} />
                  Soạn bài đầu tiên
                </Button>
              )
            }
          />
        </div>
      )}
      {editor && (
        <PostComposer
          post={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      {schedule && (
        <ScheduleDialog post={schedule} onClose={() => setSchedule(null)} />
      )}
      {scheduleDetails && (
        <PostScheduleDetails
          key={`${scheduleDetails.post.id}-${scheduleDetails.account.id}-${scheduleDetails.status || "all"}`}
          selection={scheduleDetails}
          onClose={() => setScheduleDetails(null)}
          onOpenTask={(id) => {
            setScheduleDetails(null);
            setTaskId(id);
          }}
        />
      )}
      <TaskProcessor id={taskId} onClose={() => setTaskId(null)} />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Xóa bài “${deleteTarget?.title || ""}” khỏi thư viện?`}
        description="Bài sẽ được gỡ khỏi thư viện và không thể chọn để tạo lịch mới. Thao tác này không xóa bài đã đăng trên Facebook."
        notice={
          deleteTarget?._count.tasks
            ? `Bài này liên quan đến ${deleteTarget._count.tasks} công việc. Các lịch đã tạo vẫn giữ nội dung, hình ảnh và tiếp tục được xử lý. Để dừng đăng, hãy hủy lịch trong mục Lịch đăng.`
            : null
        }
        loading={remove.isPending}
        confirmLabel="Xóa khỏi thư viện"
        onConfirm={async () => {
          if (deleteTarget) {
            try {
              await remove.mutateAsync(deleteTarget.id);
              setDeleteTarget(null);
            } catch {}
          }
        }}
      />
    </>
  );
}
