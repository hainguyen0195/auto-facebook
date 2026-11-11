"use client";
import { useState } from "react";
import {
  useResource,
  type AccountRow,
  type GroupRow,
  type PageData,
  type TaskRow,
} from "@/lib/client";
import { dateKey, formatDate, formatTime } from "@/lib/utils";
import { canonicalFacebookPost } from "@/lib/facebook-post-url";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { DatePicker } from "./ui/date-picker";
import { EmptyState, ErrorState, Field, Pagination, Skeleton } from "./common";
import { Modal } from "./ui/dialog";
import { PostLinkEditor } from "./post-link-editor";

export type PublishedPost = TaskRow & {
  interaction: { id: string; status: string; account: { name: string } } | null;
};
const interactionLabels: Record<string, string> = {
  PLANNED: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  IN_PROGRESS: "Đang thực hiện",
  RETRY_WAIT: "Chờ thử lại",
  COMPLETED: "Đã thực hiện",
  SKIPPED: "Đã bỏ qua",
  FAILED: "Chưa thực hiện được",
  NEEDS_REVIEW: "Cần kiểm tra",
};
export function PublishedPosts({
  onSelect,
}: {
  onSelect: (post: PublishedPost) => void;
}) {
  const [date, setDate] = useState(() => dateKey());
  const [accountId, setAccountId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PublishedPost | null>(null);
  const accounts = useResource<AccountRow[]>("accounts");
  const groups = useResource<PageData<GroupRow>>("groups?size=100");
  const query = useResource<PageData<PublishedPost>>(
    `published-posts?date=${date}&accountId=${accountId}&groupId=${groupId}&page=${page}`,
    { refetchInterval: 10_000 },
  );
  return (
    <section className="panel published-posts">
      <h2>
        {date === dateKey()
          ? "Bài đã đăng hôm nay"
          : `Bài đã đăng ngày ${formatDate(`${date}T12:00:00+07:00`, { year: "numeric" })}`}
      </h2>
      <p className="field-hint">
        Theo ngày ghi nhận Đã đăng (UTC+7). Chọn bài, sau đó chọn tài khoản khác
        để tương tác một lần. Máy sẽ kiểm tra bài có thể truy cập trước khi thực
        hiện.
      </p>
      <div className="form-grid">
        <Field label="Ngày ghi nhận đăng" htmlFor="published-date">
          <DatePicker
            id="published-date"
            aria-label="Ngày ghi nhận đăng"
            value={date}
            onValueChange={(value) => {
              setDate(value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Tài khoản đăng">
          <Select
            aria-label="Lọc tài khoản đăng"
            value={accountId}
            onValueChange={(v) => {
              setAccountId(v);
              setPage(1);
            }}
          >
            <option value="">Tất cả tài khoản đăng</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nhóm đăng">
          <Select
            aria-label="Lọc nhóm đăng"
            value={groupId}
            onValueChange={(v) => {
              setGroupId(v);
              setPage(1);
            }}
          >
            <option value="">Tất cả nơi đăng</option>
            {groups.data?.items.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {query.isLoading ? (
        <Skeleton rows={3} />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : !query.data?.items.length ? (
        <EmptyState
          title="Chưa có bài ghi nhận đã đăng trong ngày"
          description="Bài đang chờ duyệt hoặc cần kiểm tra chưa nằm trong danh sách này."
        />
      ) : (
        <div className="interaction-grid">
          {query.data.items.map((post) => (
            <article className="panel published-post-card" key={post.id}>
              <h3>{post.titleSnapshot}</h3>
              <p>
                {post.account.name} · {post.group?.name || "Trang cá nhân"}
              </p>
              <p className="field-hint">
                {post.recordedAt &&
                  `${formatTime(post.recordedAt)} · ${formatDate(post.recordedAt)}`}
              </p>
              <p
                style={{
                  whiteSpace: "pre-wrap",
                  maxHeight: 100,
                  overflow: "auto",
                }}
              >
                {post.contentSnapshot}
              </p>
              {post.resultUrl && canonicalFacebookPost(post.resultUrl) ? (
                <a
                  className="cell-link"
                  href={post.resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Xem bài trên Facebook
                </a>
              ) : (
                <p className="field-hint">Chưa lấy được link</p>
              )}
              {post.interaction && (
                <p className="field-hint">
                  Đã giao tương tác cho {post.interaction.account.name} ·{" "}
                  {interactionLabels[post.interaction.status] ||
                    post.interaction.status}
                </p>
              )}
              <div className="desktop-control-buttons">
                <Button
                  size="sm"
                  disabled={
                    !post.resultUrl ||
                    !canonicalFacebookPost(post.resultUrl) ||
                    !!post.interaction
                  }
                  onClick={() => onSelect(post)}
                >
                  Chọn bài này
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(post)}
                >
                  Lưu/sửa link
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {query.data && query.data.total > query.data.size && (
        <Pagination
          total={query.data.total}
          page={page}
          size={query.data.size}
          onChange={setPage}
        />
      )}
      {editing && (
        <Modal
          open
          onOpenChange={(v) => {
            if (!v) setEditing(null);
          }}
          title="Lưu link bài đã đăng"
          description={`${editing.account.name} · ${editing.group?.name || "Trang cá nhân"}`}
        >
          <PostLinkEditor
            key={editing.id}
            task={query.data?.items.find((t) => t.id === editing.id) || editing}
          />
          <div className="dialog-footer">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Đóng
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
