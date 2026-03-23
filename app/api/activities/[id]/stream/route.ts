import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const response = await fetch(
    `https://www.strava.com/api/v3/activities/${id}/streams?keys=altitude,distance&key_by_type=true`,
    {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    }
  );

  if (!response.ok) {
    return NextResponse.json({ error: "Strava API error" }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data);
}