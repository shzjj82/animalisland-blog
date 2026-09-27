"use client";

import { Suspense } from "react";
import { LoginPage } from "@/views/Login";

export default function LoginRoute() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
