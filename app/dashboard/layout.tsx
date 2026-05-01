import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Sidebar, { MobileMenuButton } from "./_components/sidebar";
import NotificationInbox from "./_components/notification-inbox";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth protection — fallback in case middleware doesn't catch it
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--color-border) px-4 sm:px-6">
          <MobileMenuButton />
          <div className="ml-auto">
            <NotificationInbox />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
