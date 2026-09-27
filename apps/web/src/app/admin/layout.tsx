"use client";

import { WorkspaceLayout } from "@/workspace/WorkspaceLayout";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}
