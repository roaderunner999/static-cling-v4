import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listNotes } from "@/lib/note-queries";
import { NotesUI } from "@/components/notes-ui";
import { SiteHeader } from "@/components/site-header";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/notes");

  const [notes, params] = await Promise.all([
    listNotes(session.user.id),
    searchParams,
  ]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteHeader />
      <NotesUI notes={notes} requestedId={params?.id} />
    </div>
  );
}
