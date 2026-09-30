/**
 * 登录后区域的加载骨架。整组页面 force-dynamic、每次导航都要等服务端查完库，
 * 成果页几百条时这段空白有一两秒——没有它，点了侧栏页面纹丝不动，用户会再点一次。
 * 形状只画「标题 + 几行」，不模仿任何具体页面：各页布局差得远，模仿哪个都像坏了。
 */
export default function Loading() {
  return (
    <div className="space-y-6 motion-safe:animate-pulse" aria-busy="true" aria-label="加载中">
      <div className="space-y-2 pt-2">
        <div className="h-7 w-40 rounded-md bg-well" />
        <div className="h-4 w-72 max-w-full rounded-md bg-well" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 rounded-[14px] bg-well" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-11 rounded-md bg-well" />
        ))}
      </div>
    </div>
  );
}
