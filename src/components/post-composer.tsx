"use client";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Globe2,
  ImagePlus,
  MessageCircle,
  RefreshCw,
  Save,
  ThumbsUp,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  useAction,
  useResource,
  type AssetRow,
  type Bootstrap,
  type PostRow,
} from "@/lib/client";
import { postSchema, type PostInput } from "@/lib/schemas";
import { assetUrl, tagList } from "@/lib/utils";
import { Field } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";

type UploadItem = {
  key: string;
  name: string;
  file?: File;
  asset?: AssetRow;
  progress: number;
  phase: "uploading" | "processing" | "done" | "error";
  error?: string;
};
export function PostComposer({
  post,
  onClose,
}: {
  post?: PostRow;
  onClose: () => void;
}) {
  const bootstrap = useResource<Bootstrap>("bootstrap");
  const loaded = useRef(false);
  const saved = useRef(false);
  const form = useForm<z.input<typeof postSchema>, unknown, PostInput>({
    resolver: zodResolver(postSchema),
    defaultValues: post
      ? {
          title: post.title,
          content: post.content,
          tags: post.tags,
          version: post.version,
          assetIds: post.assets.map((a) => a.assetId),
        }
      : { title: "", content: "", tags: [], assetIds: [] },
  });
  const [tags, setTags] = useState(post?.tags.join(", ") || "");
  const [draftSaved, setDraftSaved] = useState(false);
  const draggedImage = useRef<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [orderAnnouncement, setOrderAnnouncement] = useState("");
  const [items, setItems] = useState<UploadItem[]>(
    post?.assets.map((a) => ({
      key: a.assetId,
      name: a.asset.originalName,
      asset: a.asset,
      progress: 100,
      phase: "done",
    })) || [],
  );
  const draftKey = bootstrap.data
    ? `nhipdang:${bootstrap.data.workspace.id}:draft:${post?.id || "new"}`
    : null;
  const values = form.watch();
  const signature = JSON.stringify(values);
  const errors = form.formState.errors;
  const busy = items.some(
    (i) => i.phase === "uploading" || i.phase === "processing",
  );
  const uploadedItems = items.filter(
    (item) => item.phase === "done" && item.asset,
  );
  const save = useAction(
    (input: PostInput) =>
      api<PostRow>(
        post ? `posts/${post.id}` : "posts",
        post ? "PATCH" : "POST",
        input,
      ),
    "Đã lưu bài vào thư viện.",
  );
  useEffect(() => {
    if (!draftKey || loaded.current) return;
    loaded.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft.values || draft.version !== (post?.version || null)) return;
      form.reset(draft.values);
      setTags((draft.values.tags || []).join(", "));
      setItems(
        (draft.assets || []).map((a: AssetRow) => ({
          key: a.id,
          name: a.originalName,
          asset: a,
          phase: "done",
          progress: 100,
        })),
      );
      toast.info("Đã khôi phục bản nháp chưa lưu trên máy này.");
    } catch {
      /* Storage may be unavailable in private browsing. */
    }
  }, [draftKey, form, post?.version]);
  useEffect(() => {
    if (
      !draftKey ||
      !loaded.current ||
      saved.current ||
      (!values.title && !values.content && !items.length)
    )
      return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            version: post?.version || null,
            values: {
              ...form.getValues(),
              tags: tagList(tags),
              assetIds: items.flatMap((i) => (i.asset ? [i.asset.id] : [])),
            },
            assets: items.flatMap((i) => i.asset || []),
          }),
        );
        setDraftSaved(true);
      } catch {
        setDraftSaved(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [
    draftKey,
    signature,
    tags,
    items,
    form,
    post?.version,
    values.title,
    values.content,
  ]);
  async function upload(file: File, key: string) {
    setItems((list) =>
      list.map((i) =>
        i.key === key
          ? { ...i, phase: "uploading", progress: 0, error: undefined }
          : i,
      ),
    );
    try {
      const asset = await new Promise<AssetRow>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/v1/assets");
        xhr.withCredentials = true;
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            setItems((list) =>
              list.map((i) =>
                i.key === key
                  ? {
                      ...i,
                      progress: Math.round((event.loaded / event.total) * 100),
                    }
                  : i,
              ),
            );
        };
        xhr.upload.onload = () =>
          setItems((list) =>
            list.map((i) =>
              i.key === key ? { ...i, phase: "processing", progress: 100 } : i,
            ),
          );
        xhr.onerror = () =>
          reject(new Error("Mất kết nối khi tải ảnh. Bạn có thể thử lại."));
        xhr.ontimeout = () =>
          reject(
            new Error("Tải ảnh quá lâu. Hãy kiểm tra kết nối rồi thử lại."),
          );
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new Error(data.error || "Chưa thể tải ảnh."));
          } catch {
            reject(new Error("Phản hồi tải ảnh không hợp lệ."));
          }
        };
        const data = new FormData();
        data.append("file", file);
        xhr.send(data);
      });
      setItems((list) =>
        list.map((i) =>
          i.key === key
            ? { ...i, asset, phase: "done", progress: 100, file: undefined }
            : i,
        ),
      );
    } catch (e) {
      setItems((list) =>
        list.map((i) =>
          i.key === key
            ? { ...i, phase: "error", error: (e as Error).message }
            : i,
        ),
      );
    }
  }
  async function selectFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files).slice(0, Math.max(0, 20 - items.length));
    if (selected.length < files.length) toast.info("Mỗi bài tối đa 20 ảnh.");
    const next: UploadItem[] = selected.map((file) => ({
      key: crypto.randomUUID(),
      name: file.name,
      file,
      phase: file.size > 10 * 1024 * 1024 ? "error" : "uploading",
      progress: 0,
      ...(file.size > 10 * 1024 * 1024 ? { error: "Ảnh vượt 10 MB." } : {}),
    }));
    setItems((list) => [...list, ...next]);
    for (const item of next)
      if (item.phase !== "error") await upload(item.file!, item.key);
  }
  function removeItem(item: UploadItem) {
    setItems((list) => list.filter((i) => i.key !== item.key));
    if (item.asset && !post?.assets.some((a) => a.assetId === item.asset!.id))
      api(`assets/${item.asset.id}`, "DELETE").catch(() => {});
  }
  function moveImage(fromKey: string, toKey: string) {
    if (save.isPending || fromKey === toKey) return;
    setItems((list) => {
      const from = list.findIndex((item) => item.key === fromKey && item.asset);
      const to = list.findIndex((item) => item.key === toKey && item.asset);
      if (from < 0 || to < 0) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    const item = uploadedItems.find((image) => image.key === fromKey);
    const position = uploadedItems.findIndex((image) => image.key === toKey);
    if (item && position >= 0)
      setOrderAnnouncement(
        `Đã chuyển ${item.name} đến vị trí ${position + 1}.`,
      );
    setDraftSaved(false);
  }
  function endImageDrag() {
    draggedImage.current = null;
    setDraggedKey(null);
    setDropTarget(null);
  }
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending && !busy) onClose();
      }}
      title={post ? "Chỉnh sửa bài viết" : "Một ý tưởng, một bài viết mới"}
      description="Chuẩn bị nội dung và ảnh trước khi chọn tài khoản, nhóm và thời gian đăng."
      wide
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          try {
            await save.mutateAsync({
              ...input,
              tags: tagList(tags),
              assetIds: items.flatMap((i) => (i.asset ? [i.asset.id] : [])),
            });
            saved.current = true;
            try {
              if (draftKey) localStorage.removeItem(draftKey);
            } catch {}
            onClose();
          } catch {}
        })}
      >
        <div className="composer-grid">
          <div>
            <Field
              label="Tên bài trong thư viện"
              htmlFor="post-title"
              error={errors.title?.message}
              hint="Tên này giúp bạn tìm lại bài, không nằm trong nội dung đăng."
            >
              <input
                id="post-title"
                placeholder="Ví dụ: Bộ sưu tập mới — tháng 11"
                {...form.register("title")}
              />
            </Field>
            <Field
              label="Nội dung bài viết"
              htmlFor="post-content"
              error={errors.content?.message}
            >
              <textarea
                id="post-content"
                rows={9}
                placeholder="Bạn muốn kể điều gì với khách hàng hôm nay?…"
                maxLength={63206}
                {...form.register("content")}
              />
              <div className="field-hint" style={{ textAlign: "right" }}>
                {values.content?.length || 0}/63.206 ký tự
              </div>
            </Field>
            <Field label="Nhãn sản phẩm" htmlFor="post-tags">
              <input
                id="post-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Đồ nhà, Hàng mới, Ưu đãi…"
              />
            </Field>
            <Field label="Hình ảnh">
              <label className="upload-zone">
                <ImagePlus size={23} strokeWidth={1.4} />
                <strong>Thêm hình ảnh cho bài viết</strong>
                <small>JPG, PNG, WebP · Tối đa 10 MB/ảnh, 20 ảnh</small>
                <input
                  aria-label="Thêm ảnh bài viết"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy || items.length >= 20 || save.isPending}
                  onChange={(e) => {
                    selectFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              {uploadedItems.length > 1 && (
                <p className="field-hint" id="image-order-hint">
                  Kéo thả ảnh để đổi vị trí. Ảnh số 1 nằm đầu khi đăng. Bạn cũng
                  có thể dùng nút mũi tên dưới mỗi ảnh.
                </p>
              )}
              <div
                className="upload-items"
                role="list"
                aria-label="Thứ tự ảnh bài viết"
                aria-describedby={
                  uploadedItems.length > 1 ? "image-order-hint" : undefined
                }
              >
                {uploadedItems.map((item, index) => (
                  <div
                    className={`upload-item${draggedKey === item.key ? " upload-item-dragging" : ""}${dropTarget === item.key ? " upload-item-drop-target" : ""}`}
                    key={item.key}
                    role="listitem"
                    aria-label={`Ảnh ${index + 1}: ${item.name}`}
                    draggable={!save.isPending && uploadedItems.length > 1}
                    onDragStart={(event) => {
                      if (save.isPending) {
                        event.preventDefault();
                        return;
                      }
                      draggedImage.current = item.key;
                      setDraggedKey(item.key);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.key);
                    }}
                    onDragOver={(event) => {
                      if (!draggedImage.current || save.isPending) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget(
                        item.key === draggedImage.current ? null : item.key,
                      );
                    }}
                    onDragLeave={(event) => {
                      if (
                        !(event.relatedTarget instanceof Node) ||
                        !event.currentTarget.contains(event.relatedTarget)
                      )
                        setDropTarget((current) =>
                          current === item.key ? null : current,
                        );
                    }}
                    onDrop={(event) => {
                      if (!draggedImage.current) return;
                      event.preventDefault();
                      moveImage(draggedImage.current, item.key);
                      endImageDrag();
                    }}
                    onDragEnd={endImageDrag}
                  >
                    <img
                      src={assetUrl(item.asset!.id)}
                      alt={item.name}
                      draggable={false}
                    />
                    <span className="upload-image-position">
                      {index === 0 ? "1 · Ảnh đầu" : index + 1}
                    </span>
                    <button
                      type="button"
                      className="upload-remove"
                      aria-label={`Bỏ ảnh ${item.name}`}
                      onClick={() => removeItem(item)}
                      disabled={save.isPending}
                    >
                      <X size={12} />
                    </button>
                    <small title={item.name}>{item.name}</small>
                    {uploadedItems.length > 1 && (
                      <div className="upload-order-controls">
                        <button
                          type="button"
                          aria-label={`Chuyển ${item.name} lên trước`}
                          title="Chuyển lên trước"
                          disabled={save.isPending || index === 0}
                          onClick={() =>
                            moveImage(item.key, uploadedItems[index - 1].key)
                          }
                        >
                          <ArrowLeft size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Chuyển ${item.name} ra sau`}
                          title="Chuyển ra sau"
                          disabled={
                            save.isPending || index === uploadedItems.length - 1
                          }
                          onClick={() =>
                            moveImage(item.key, uploadedItems[index + 1].key)
                          }
                        >
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <span className="sr-only" role="status" aria-live="polite">
                {orderAnnouncement}
              </span>
              {items
                .filter((i) => i.phase !== "done")
                .map((item) => (
                  <div className="upload-progress" key={item.key}>
                    <div>
                      <span>{item.name}</span>
                      <span>
                        {item.phase === "processing"
                          ? "100% · Đang xử lý ảnh…"
                          : item.phase === "error"
                            ? "Chưa tải được"
                            : `${item.progress}%`}
                      </span>
                    </div>
                    <div className="progress-track">
                      <span style={{ width: `${item.progress}%` }} />
                    </div>
                    {item.phase === "error" && (
                      <div className="upload-error">
                        <p role="alert">{item.error}</p>
                        {item.file && item.file.size <= 10 * 1024 * 1024 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => upload(item.file!, item.key)}
                          >
                            <RefreshCw size={12} />
                            Thử lại
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeItem(item)}
                        >
                          Bỏ ảnh
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              <p className="field-hint">
                Ảnh được xoay đúng chiều, giới hạn cạnh 2.400 px và loại bỏ
                metadata trước khi lưu.
              </p>
            </Field>
            {draftSaved && (
              <div className="draft-state">
                <Check size={12} />
                Đã giữ bản nháp trên máy này
              </div>
            )}
          </div>
          <aside className="preview-column">
            <div className="preview-label">
              <Eye size={14} />
              XEM TRƯỚC NỘI DUNG
            </div>
            <div className="fb-preview">
              <div className="fb-preview-header">
                <span className="avatar avatar-teal">NĐ</span>
                <div>
                  <strong>Tài khoản của bạn</strong>
                  <small>
                    Vừa xong · <Globe2 size={9} />
                  </small>
                </div>
              </div>
              <div className="fb-preview-content">
                {values.content || "Nội dung của bạn sẽ xuất hiện ở đây…"}
              </div>
              {items.some((i) => i.asset) && (
                <div className="fb-preview-images">
                  {items
                    .filter((i) => i.asset)
                    .slice(0, 4)
                    .map((item) => (
                      <img
                        key={item.key}
                        src={assetUrl(item.asset!.id)}
                        alt={item.name}
                      />
                    ))}
                </div>
              )}
              <div className="fb-preview-footer">
                <span>Thích</span>
                <span>Bình luận</span>
                <span>Chia sẻ</span>
              </div>
            </div>
            <p className="field-hint" style={{ marginTop: 12 }}>
              Minh họa cách trình bày. Giao diện và đối tượng xem thực tế do
              Facebook quyết định.
            </p>
            {post && (
              <div className="notice notice-teal" style={{ marginTop: 15 }}>
                <Check size={15} />
                <p>
                  Lịch đã tạo giữ nguyên nội dung cũ. Bản sửa này chỉ áp dụng
                  khi bạn tạo lịch mới.
                </p>
              </div>
            )}
          </aside>
        </div>
        <div className="dialog-footer">
          <Button
            variant="outline"
            type="button"
            onClick={onClose}
            disabled={save.isPending || busy}
          >
            Đóng, giữ nháp
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={busy || items.some((i) => i.phase === "error")}
          >
            <Save size={15} />
            Lưu vào thư viện
          </Button>
        </div>
      </form>
    </Modal>
  );
}
