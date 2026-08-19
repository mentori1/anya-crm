import { NextRequest, NextResponse } from "next/server";
import { isLocalOwnerBypass, isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (isLocalOwnerBypass(request.headers.get("host"), request.headers.get("x-forwarded-host"))) {
    return NextResponse.next();
  }
  const pathname = request.nextUrl.pathname;
  if (pathname === "/login" || pathname.startsWith("/cabinet") || pathname.startsWith("/api/clients/")) return NextResponse.next();

  const valid = await isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (valid) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
