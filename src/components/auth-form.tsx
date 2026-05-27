"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

type Mode = "login" | "signup";

/**
 * Shared email/password form for both sign-in and sign-up, with an optional
 * Google button (only rendered when the server says OAuth is configured).
 */
export function AuthForm({
  mode,
  googleEnabled,
  redirectTo,
}: {
  mode: Mode;
  googleEnabled: boolean;
  redirectTo: string;
}) {
  const router = useRouter();
  const isSignup = mode === "signup";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const { error } = isSignup
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password });

    if (error) {
      setError(error.message ?? "Something went wrong. Please try again.");
      setPending(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  async function onGoogle() {
    setError(null);
    setPending(true);
    await authClient.signIn.social({ provider: "google", callbackURL: redirectTo });
  }

  return (
    <div className="w-full max-w-sm">
      <p className="mb-1 font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
        Static Cling
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {isSignup && (
          <Field
            label="Name"
            type="text"
            value={name}
            onChange={setName}
            autoComplete="name"
            required
          />
        )}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={isSignup ? "new-password" : "current-password"}
          minLength={8}
          required
        />

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 transition disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {pending ? "…" : isSignup ? "Sign up" : "Sign in"}
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <button
            type="button"
            onClick={onGoogle}
            disabled={pending}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Continue with Google
          </button>
        </>
      )}

      <p className="mt-6 text-sm text-zinc-500">
        {isSignup ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
        >
          {isSignup ? "Sign in" : "Sign up"}
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  ...rest
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        {...rest}
      />
    </label>
  );
}
