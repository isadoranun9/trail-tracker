"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import TrailMap from "@/components/TrailMap";

export default function Home() {
  const { data: session, status } = useSession();

  if (status === "loading") return <p>Loading...</p>;

  if (session) {
    return (
      <div>
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 10 }}>
          <button onClick={() => signOut()}>Sign out</button>
        </div>
        <TrailMap />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
      <button onClick={() => signIn("strava")}>Login with Strava</button>
    </div>
  );
}