"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import { Download, FileText, Plus, Trash2, Upload } from "lucide-react";
import { FolderArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDocCategory,
  deletePersonalAttachment,
  uploadPersonalAttachment,
} from "@/lib/actions/attachment-actions";
import { formatFileSize, formatTimestampDate } from "@/lib/format";
import { IDLE_FORM_STATE, type FormState, formMessageClass } from "@/lib/form-state";
import {
  beginDocumentDelete,
  deleteNoticeFromState,
  shouldResetUploadForm,
  type DocumentLibraryNotice,
} from "@/lib/document-library-state";
import {
  attachmentDownloadHref,
  groupPersonalDocumentsByCategory,
} from "@/lib/personal-documents";

type Category = { id: string; name: string; sortOrder: number };
type Document = {
  id: string;
  docCategoryId: string | null;
  filename: string;
  size: number;
  note: string | null;
  uploadedAt: Date;
};

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <>
      {errors.map((error) => (
        <p key={error} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </>
  );
}

function UploadSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Upload className="size-3.5" aria-hidden />
      {pending ? "上传中…" : "上传文档"}
    </Button>
  );
}

function CategorySubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      <Plus className="size-3.5" aria-hidden />
      {pending ? "新建中…" : "新建分类"}
    </Button>
  );
}

function DeleteDocumentButton({
  attachmentId,
  filename,
  deletingThis,
  disabled,
  onDelete,
}: {
  attachmentId: string;
  filename: string;
  deletingThis: boolean;
  disabled: boolean;
  onDelete: (attachmentId: string, filename: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-destructive"
      title={deletingThis ? "删除中" : disabled ? "正在删除其他文档" : "删除"}
      aria-label={`${deletingThis ? "正在删除" : disabled ? "删除暂不可用" : "删除"} ${filename}`}
      disabled={disabled}
      onClick={() => {
        if (confirm(`删除「${filename}」？文件会一并清理，无法恢复。`)) {
          onDelete(attachmentId, filename);
        }
      }}
    >
      <Trash2 className="size-3.5" aria-hidden />
    </Button>
  );
}

function DeleteNotice({ notice }: { notice: DocumentLibraryNotice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={formMessageClass(notice.tone)}
    >
      {notice.message}
    </p>
  );
}

export function DocumentLibrary({
  categories,
  documents,
}: {
  categories: Category[];
  documents: Document[];
}) {
  const [uploadState, uploadAction] = useActionState(
    uploadPersonalAttachment,
    IDLE_FORM_STATE,
  );
  const [categoryState, categoryAction] = useActionState(
    createDocCategory,
    IDLE_FORM_STATE,
  );
  const uploadFormRef = useRef<HTMLFormElement>(null);
  const lastUploadResetResult = useRef<FormState | undefined>(undefined);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const deleteInFlightRef = useRef<string | null>(null);
  const [deleteNotice, setDeleteNotice] =
    useState<DocumentLibraryNotice | null>(null);
  const [, startDeleteTransition] = useTransition();
  const groups = groupPersonalDocumentsByCategory(
    categories,
    documents.filter(
      (document): document is Document & { docCategoryId: string } =>
        document.docCategoryId !== null,
    ),
  );
  useEffect(() => {
    if (shouldResetUploadForm(lastUploadResetResult.current, uploadState)) {
      uploadFormRef.current?.reset();
      lastUploadResetResult.current = uploadState;
    }
  }, [uploadState]);

  function deleteDocument(attachmentId: string, filename: string) {
    const nextDelete = beginDocumentDelete(
      deleteInFlightRef.current,
      attachmentId,
    );
    if (!nextDelete.started) return;
    deleteInFlightRef.current = nextDelete.pendingDeleteId;
    setPendingDeleteId(attachmentId);
    startDeleteTransition(async () => {
      try {
        const result = await deletePersonalAttachment(attachmentId);
        setDeleteNotice(deleteNoticeFromState(result));
      } catch {
        setDeleteNotice({
          tone: "error",
          message: `删除「${filename}」失败，请稍后重试`,
        });
      } finally {
        if (deleteInFlightRef.current === attachmentId)
          deleteInFlightRef.current = null;
        setPendingDeleteId((current) =>
          current === attachmentId ? null : current,
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <form
          ref={uploadFormRef}
          action={uploadAction}
          className="surface space-y-4 p-5"
        >
          <div>
            <h2 className="text-sm font-medium">上传常用文档</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              归到个人档案，不会作为课题或成果的证明材料。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="space-y-1.5">
              <Label htmlFor="personal-document-file">文件</Label>
              <Input
                id="personal-document-file"
                name="file"
                type="file"
                required
                aria-describedby="personal-document-file-hint"
                aria-invalid={uploadState.fieldErrors?.file ? true : undefined}
                className="file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs aria-invalid:border-destructive"
              />
              <FieldErrors errors={uploadState.fieldErrors?.file} />
              <p
                id="personal-document-file-hint"
                className="text-xs text-muted-foreground"
              >
                支持 PDF、Word、Excel、PPT、图片、zip，单个不超过 25MB
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="personal-document-category">分类</Label>
              <select
                id="personal-document-category"
                name="categoryId"
                required
                defaultValue=""
                aria-invalid={
                  uploadState.fieldErrors?.categoryId ? true : undefined
                }
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
              >
                <option value="" disabled>
                  请选择
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <FieldErrors errors={uploadState.fieldErrors?.categoryId} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="personal-document-note">备注</Label>
            <Input
              id="personal-document-note"
              name="note"
              placeholder="如「2026 年修订版」"
            />
            <FieldErrors errors={uploadState.fieldErrors?.note} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <UploadSubmitButton />
            {uploadState.message ? (
              <span
                role="status"
                className={
                  formMessageClass(uploadState.ok)
                }
              >
                {uploadState.message}
              </span>
            ) : null}
          </div>
        </form>

        <form action={categoryAction} className="surface space-y-4 p-5">
          <div>
            <h2 className="text-sm font-medium">新建分类</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              新建后页面会刷新，可立即在上传表单中选择。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="personal-document-category-name">分类名称</Label>
            <Input
              id="personal-document-category-name"
              name="name"
              required
              maxLength={50}
              placeholder="如：课程标准"
              aria-invalid={categoryState.fieldErrors?.name ? true : undefined}
            />
            <FieldErrors errors={categoryState.fieldErrors?.name} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CategorySubmitButton />
            {categoryState.message ? (
              <span
                role="status"
                className={
                  formMessageClass(categoryState.ok)
                }
              >
                {categoryState.message}
              </span>
            ) : null}
          </div>
        </form>
      </div>

      <DeleteNotice notice={deleteNotice} />

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-10 text-center">
          <FolderArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            还没有常用文档。上传人才培养方案、课程标准或申报参考资料后，会按分类归档在这里。
          </p>
        </div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[56.25rem] text-left text-sm">
            <caption className="sr-only">按分类归档的常用文档</caption>
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  文件名
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  分类
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 font-medium whitespace-nowrap"
                >
                  大小
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 font-medium whitespace-nowrap"
                >
                  上传日期
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  备注
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  下载
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  删除
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody
                key={group.category.id}
                className="border-b last:border-b-0"
              >
                <tr className="bg-muted/45 text-xs text-muted-foreground">
                  <th
                    scope="rowgroup"
                    colSpan={7}
                    className="px-4 py-2.5 text-left font-medium tracking-wide"
                  >
                    <span className="mr-2 inline-block border-l-2 border-primary/55 pl-2">
                      {group.category.name}
                    </span>
                    <span className="tabular-nums">
                      {group.items.length} 份
                    </span>
                  </th>
                </tr>
                {group.items.map((document) => (
                  <tr
                    key={document.id}
                    className="border-t align-top transition-colors hover:bg-muted/35"
                  >
                    <td className="max-w-56 px-4 py-3">
                      <div className="flex gap-2">
                        <FileText
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <p
                          className="line-clamp-2 font-medium"
                          title={document.filename}
                        >
                          {document.filename}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                      {group.category.name}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatFileSize(document.size)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatTimestampDate(document.uploadedAt)}
                    </td>
                    <td className="max-w-64 px-3 py-3 text-muted-foreground">
                      {document.note ? (
                        <p className="line-clamp-2" title={document.note}>
                          {document.note}
                        </p>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        render={
                          <a
                            href={attachmentDownloadHref(
                              document.id,
                              document.filename,
                            )}
                            download
                          />
                        }
                        nativeButton={false}
                        variant="ghost"
                        size="sm"
                        aria-label={`下载 ${document.filename}`}
                      >
                        <Download className="size-3.5" aria-hidden />
                        下载
                      </Button>
                    </td>
                    <td className="px-3 py-3">
                      <DeleteDocumentButton
                        attachmentId={document.id}
                        filename={document.filename}
                        deletingThis={pendingDeleteId === document.id}
                        disabled={pendingDeleteId !== null}
                        onDelete={deleteDocument}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
