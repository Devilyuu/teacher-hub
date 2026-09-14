import { NextResponse, type NextRequest } from "next/server";
import {
  isPublicUnauthenticatedPath,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth";

// Next.js 16 起 middleware 更名为 proxy，文件名和导出名都变了，行为不变。
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicUnauthenticatedPath(pathname) && pathname !== "/login") {
    return NextResponse.next();
  }

  const isLoggedIn = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", request.url);
    // 登录后跳回原本要去的地方
    if (pathname !== "/") {
      loginUrl.searchParams.set("from", `${pathname}${search}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // 静态资源与 favicon 不走鉴权
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
