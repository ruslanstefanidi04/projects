import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const protectedPaths = [
  "/day",
  "/week",
  "/month",
  "/notes",
  "/pomodoro",
  "/vault",
  "/finance",
  "/tasks",
  "/settings",
  "/contour",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = protectedPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!needsAuth) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/day/:path*",
    "/week/:path*",
    "/month/:path*",
    "/notes/:path*",
    "/pomodoro/:path*",
    "/vault/:path*",
    "/finance/:path*",
    "/tasks/:path*",
    "/settings/:path*",
    "/contour/:path*",
  ],
};
