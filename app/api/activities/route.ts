import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const allActivities = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=50&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      }
    );

    if (!response.ok) break;

    const batch = await response.json();

    if (batch.length === 0) break;

    allActivities.push(...batch);
    page++;
  }

  const hikes = allActivities.filter(
    (a: { type: string }) => a.type === "Hike"
  );

  return NextResponse.json(hikes);
}