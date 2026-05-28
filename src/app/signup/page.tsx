import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";
import { googleEnabled } from "@/env";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const [session, sp] = await Promise.all([getSession(), searchParams]);
  const redirectTo = sp.redirect ?? "/";
  if (session) redirect(redirectTo);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <AuthForm mode="signup" googleEnabled={googleEnabled} redirectTo={redirectTo} />
    </main>
  );
}
