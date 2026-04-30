"use client";

import { Inbox } from "@novu/nextjs";
import { useUser } from "@clerk/nextjs";

export default function NotificationInbox() {
  const { user } = useUser();

  if (!user?.id) return null;

  const applicationIdentifier =
    process.env.NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER;

  if (!applicationIdentifier) return null;

  return (
    <Inbox
      applicationIdentifier={applicationIdentifier}
      subscriberId={user.id}
      appearance={{
        variables: {
          colorPrimary: "var(--color-primary)",
          colorPrimaryForeground: "var(--color-primary-foreground)",
          colorSecondary: "var(--color-muted)",
          colorSecondaryForeground: "var(--color-muted-foreground)",
          colorBackground: "var(--color-background)",
          colorForeground: "var(--color-foreground)",
          colorNeutral: "var(--color-border)",
          fontSize: "inherit",
        },
        elements: {
          bellIcon: {
            width: "20px",
            height: "20px",
            color: "var(--color-muted-foreground)",
          },
        },
      }}
    />
  );
}
