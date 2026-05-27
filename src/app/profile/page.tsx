import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { SignOutButton } from "@/components/sign-out-button";
import { billingEnabled } from "@/env";
import { isAdmin } from "@/lib/admin";
import { isPro, PRO_PRICE_USD } from "@/lib/billing";
import { startCheckout, openBillingPortal } from "@/lib/billing-actions";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/profile");

  const { user } = session;
  const pro = isPro(user);
  const admin = isAdmin(user);

  const rows = await db
    .select({
      subscriptionStatus: userTable.subscriptionStatus,
      currentPeriodEnd: userTable.currentPeriodEnd,
    })
    .from(userTable)
    .where(eq(userTable.id, user.id))
    .limit(1);
  const billing = rows[0];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <p className="mb-1 font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
          Static Cling
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Your profile
        </h1>
        {admin && (
          <Link
            href="/admin"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-violet-300 px-3 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40"
          >
            Admin console →
          </Link>
        )}
      </div>

      <dl className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        <Row label="Name" value={user.name || "—"} />
        <Row label="Email" value={user.email} />
        <Row label="Verified" value={user.emailVerified ? "Yes" : "Not yet"} />
        <Row label="Plan" value={pro ? "Pro" : "Free"} />
        <Row
          label="Member since"
          value={new Date(user.createdAt).toLocaleDateString()}
        />
      </dl>

      {/* --- Billing --- */}
      <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="mb-3 font-mono text-xs uppercase tracking-wider text-zinc-500">
          Billing
        </p>

        {!billingEnabled ? (
          <p className="text-sm text-zinc-500">
            Billing isn’t configured on this server yet.
          </p>
        ) : pro ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              You’re on <strong>Pro</strong>
              {billing?.subscriptionStatus
                ? ` (${billing.subscriptionStatus})`
                : ""}
              .
              {billing?.currentPeriodEnd
                ? ` Renews ${new Date(billing.currentPeriodEnd).toLocaleDateString()}.`
                : ""}
            </p>
            <form action={openBillingPortal}>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Manage billing
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              You’re on the <strong>Free</strong> plan. Pro unlocks the Lab,
              scheduled widgets, and a much higher usage limit.
            </p>
            <form action={startCheckout}>
              <button
                type="submit"
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
              >
                Upgrade to Pro — ${PRO_PRICE_USD}/mo
              </button>
            </form>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-400">
          Signed in · {user.email}
        </span>
        <SignOutButton />
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <dt className="font-mono text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}
