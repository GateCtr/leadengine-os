"use client";

import { useSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignInPage() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [globalError, setGlobalError] = useState("");

  const isFetching = fetchStatus === "fetching" || !signIn;

  const handleEmailPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn) return;
    setGlobalError("");

    try {
      const { error } = await signIn.password({
        identifier: email,
        password,
      });

      if (error) {
        setGlobalError(error.longMessage || error.message);
        return;
      }

      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) return;
            const url = decorateUrl("/dashboard");
            router.push(url);
          },
        });
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Erreur lors de la connexion"
      );
    }
  };

  const handleOAuthSignIn = async (
    strategy: "oauth_google" | "oauth_github"
  ) => {
    if (!signIn) return;
    setGlobalError("");

    try {
      const { error } = await signIn.sso({
        strategy,
        redirectUrl: "/sign-in/sso-callback",
        redirectCallbackUrl: "/dashboard",
      });

      if (error) {
        setGlobalError(error.longMessage || error.message);
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Erreur lors de la connexion OAuth"
      );
    }
  };

  const displayError =
    globalError || errors.global?.[0]?.message || "";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-(--color-border) bg-(--color-background) p-8">
        <h1 className="text-2xl font-semibold">Connexion</h1>
        <p className="mt-2 text-sm text-(--color-muted-foreground)">
          Connectez-vous à LeadEngine OS.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => handleOAuthSignIn("oauth_google")}
            disabled={isFetching}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-(--color-border) bg-(--color-muted) px-4 py-2.5 text-sm font-medium transition-colors hover:bg-(--color-border) disabled:opacity-50 cursor-pointer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continuer avec Google
          </button>

          <button
            type="button"
            onClick={() => handleOAuthSignIn("oauth_github")}
            disabled={isFetching}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-(--color-border) bg-(--color-muted) px-4 py-2.5 text-sm font-medium transition-colors hover:bg-(--color-border) disabled:opacity-50 cursor-pointer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Continuer avec GitHub
          </button>
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-(--color-border)" />
          <span className="text-xs text-(--color-muted-foreground)">ou</span>
          <div className="h-px flex-1 bg-(--color-border)" />
        </div>

        <form onSubmit={handleEmailPasswordSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.com"
              className="w-full rounded-md border border-(--color-border) bg-(--color-muted) px-3 py-2 text-sm outline-none transition-colors placeholder:text-(--color-muted-foreground) focus:border-(--color-primary) focus:ring-1 focus:ring-(--color-primary)"
            />
            {errors.fields.identifier && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.fields.identifier.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-(--color-border) bg-(--color-muted) px-3 py-2 text-sm outline-none transition-colors placeholder:text-(--color-muted-foreground) focus:border-(--color-primary) focus:ring-1 focus:ring-(--color-primary)"
            />
            {errors.fields.password && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.fields.password.message}
              </p>
            )}
          </div>

          {displayError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
              {displayError}
            </p>
          )}

          <button
            type="submit"
            disabled={isFetching || !email || !password}
            className="w-full rounded-md bg-(--color-primary) px-4 py-2.5 text-sm font-medium text-(--color-primary-foreground) transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {isFetching ? "Connexion en cours…" : "Se connecter"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-(--color-muted-foreground)">
          Pas encore de compte ?{" "}
          <Link
            href="/sign-up"
            className="font-medium text-(--color-primary) hover:underline"
          >
            Créer un compte
          </Link>
        </p>

        {/* Required by Clerk bot protection — CAPTCHA widget mounts here */}
        <div id="clerk-captcha" className="mt-4" />
      </div>
    </div>
  );
}
