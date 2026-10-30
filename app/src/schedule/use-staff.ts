import { useEffect, useState } from "react";

import { api } from "@/api/client";
import type { components } from "@/api/schema";

export type StaffMember = components["schemas"]["StaffOut"];

/**
 * The people who can teach, for an owner's coach picker; nobody else may ask, so for anyone else it is
 * an empty list without a request. ponytail: if it fails the picker is simply not shown and the class
 * keeps its coach (the caller on create); add a retry if that ever matters.
 */
export function useStaff(enabled: boolean): StaffMember[] {
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    if (!enabled) return;
    api
      .GET("/staff")
      .then(({ data }) => data && setStaff(data))
      .catch(() => {});
  }, [enabled]);

  return staff;
}
