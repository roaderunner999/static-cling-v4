import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listConversations } from "@/lib/chat-queries";
import { getUserPreferences } from "@/lib/settings-queries";
import { monthlyMessageCount } from "@/lib/usage";
import { monthlyMessageLimit, isPro } from "@/lib/billing";
import { MODELS, isKnownModel, type ModelId } from "@/lib/models";
import { chatEnabled } from "@/env";
import { ChatUI } from "@/components/chat-ui";
import { SiteHeader } from "@/components/site-header";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/chat");
  const { user } = session;

  const [conversations, used, params, prefs] = await Promise.all([
    listConversations(user.id),
    monthlyMessageCount(user.id),
    searchParams,
    getUserPreferences(user.id),
  ]);

  const initialModel: ModelId | "auto" =
    prefs.defaultModel && isKnownModel(prefs.defaultModel)
      ? prefs.defaultModel
      : "auto";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteHeader />
      <ChatUI
        conversations={conversations}
        models={MODELS}
        enabled={chatEnabled}
        pro={isPro(user)}
        usage={{ used, limit: monthlyMessageLimit(user) }}
        requestedId={params?.id}
        initialModel={initialModel}
      />
    </div>
  );
}
