"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/owner-auth";

export async function refreshSystemStatus() {
  await requireOwner();
  revalidatePath("/settings");
}
