import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { NuqsAdapter } from "nuqs/adapters/next/app";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return (
    <NuqsAdapter>
      <AppShell user={{ name: session.user.name, email: session.user.email }}>
        {children}
      </AppShell>
    </NuqsAdapter>
  );
}
