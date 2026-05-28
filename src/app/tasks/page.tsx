import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listTasks } from "@/lib/task-queries";
import { TasksUI } from "@/components/tasks-ui";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/tasks");

  const tasks = await listTasks(session.user.id);

  return (
    <>
      <SiteHeader />
      <TasksUI initial={tasks} />
    </>
  );
}
