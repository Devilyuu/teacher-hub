import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { saveProfile } from "./actions";
import { DocumentLibrary } from "./document-library";
import { loadProfilePageData } from "./profile-page-data";
import { ProfileForm, type ProfileFormDefaults } from "./profile-form";
import { PROFILE_TABS, resolveProfileTab } from "@/lib/personal-documents";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "我的档案" };

const EMPTY: ProfileFormDefaults = {
  name: "",
  unit: "",
  department: null,
  title: null,
  currentTitle: null,
  currentTitleSince: null,
  phone: null,
  email: null,
  obsidianVaultPath: null,
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = resolveProfileTab(rawTab);
  const data = await loadProfilePageData(tab);

  return (
    <div className="space-y-6">
      <header className="space-y-2 pt-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          设置
        </Link>
        <h1 className="page-title">我的档案</h1>
        <p className="measure text-muted-foreground">
          导出申报表和结题材料时，
          <span className="text-foreground">姓名和承担单位</span>
          直接取这里；职称口径的成果范围按现职称取得日期过滤。
        </p>
      </header>

      <nav aria-label="档案分区" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PROFILE_TABS.map((item) => {
          const active = item.value === tab;
          return (
            <Link
              key={item.value}
              href={item.value === "profile" ? "/profile" : "/profile?tab=documents"}
              aria-current={active ? "page" : undefined}
              className={active ? "shrink-0 rounded-full bg-muted px-3 py-1.5 text-sm font-medium whitespace-nowrap" : "shrink-0 rounded-full px-3 py-1.5 text-sm text-muted-foreground whitespace-nowrap hover:text-foreground"}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {data.tab === "profile" ? (
        // 大表单统一铺在画布上，不装卡（和新建课题/新建成果一个模式）；
        // 限宽同 builders 的 max-w-3xl，不限的话两列输入框在 1272px 下宽得发飘
        <div className="max-w-3xl">
          <ProfileForm
            action={saveProfile}
            defaults={data.profile ?? EMPTY}
            dataVersion={data.profile?.updatedAt.toISOString()}
          />
        </div>
      ) : (
        <DocumentLibrary categories={data.categories} documents={data.attachments} />
      )}
    </div>
  );
}
