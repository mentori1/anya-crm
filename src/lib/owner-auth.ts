import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocalOwnerBypass, isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function requireOwner() {
  const requestHeaders = await headers();
  if (
    isLocalOwnerBypass(
      requestHeaders.get("host"),
      requestHeaders.get("x-forwarded-host"),
    )
  ) {
    return;
  }

  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) redirect("/login");
}
