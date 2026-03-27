import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const after = searchParams.get("after");

  const allActivities = [];
  let page = 1;

  while (true) {
    const url = new URL("https://www.strava.com/api/v3/athlete/activities");
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));
    if (after) url.searchParams.set("after", after);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });

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