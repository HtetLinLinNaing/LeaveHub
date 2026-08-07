"use server";

import { updateTag } from "next/cache";

export async function revalidateHolidays() {
  updateTag("holidays");
}

export async function revalidateLeaveTypes() {
  updateTag("leave-types");
}
