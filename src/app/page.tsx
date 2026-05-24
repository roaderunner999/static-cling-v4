export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
        Lyons Software
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Static Cling
        <span className="text-zinc-400"> v4</span>
      </h1>
      <p className="max-w-sm text-sm text-zinc-500">
        Foundation deployed. Notes, Chat, and Dashboard arrive in later stages.
      </p>
    </main>
  );
}
