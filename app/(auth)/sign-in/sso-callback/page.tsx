"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SignInSSOCallback() {
  return <AuthenticateWithRedirectCallback />;
}
