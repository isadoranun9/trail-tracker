import { NextAuthOptions } from "next-auth";
import StravaProvider from "next-auth/providers/strava";

export const authOptions: NextAuthOptions = {
  providers: [
    StravaProvider({
      clientId: process.env.STRAVA_CLIENT_ID!,
      clientSecret: process.env.STRAVA_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read,activity:read_all",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // First login — save tokens
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        return token;
      }

      // Token still valid — return as is
      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token;
      }

      // Token expired — refresh it
      try {
        const response = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: token.refreshToken,
          }),
        });

        const refreshed = await response.json();

        if (!response.ok) throw refreshed;

        return {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          expiresAt: refreshed.expires_at,
        };
      } catch (error) {
        console.error("Failed to refresh Strava token", error);
        return { ...token, error: "RefreshTokenError" };
      }
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
};