import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Lightweight middleware — only handles redirect of authenticated users away from auth pages.
// Dashboard protection is handled server-side in app/dashboard/layout.tsx via auth().
// This avoids the Next.js 16 Edge runtime "TypeError: immutable" issue with auth.protect().
export default clerkMiddleware(async (auth, req) => {
  if (isAuthRoute(req)) {
    const { userId } = await auth();
    if (userId) {
      const url = new URL("/dashboard", req.url);
      return Response.redirect(url);
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
