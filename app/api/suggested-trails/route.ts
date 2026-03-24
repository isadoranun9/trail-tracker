export const revalidate = 3600;

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const north = parseFloat(searchParams.get("north") || "");
  const south = parseFloat(searchParams.get("south") || "");
  const east = parseFloat(searchParams.get("east") || "");
  const west = parseFloat(searchParams.get("west") || "");

  if (isNaN(north) || isNaN(south) || isNaN(east) || isNaN(west)) {
    return NextResponse.json({ error: "Missing bounds" }, { status: 400 });
  }

  // Clamp to small area
  const centerLat = (north + south) / 2;
  const centerLng = (east + west) / 2;
  const maxDelta = 0.15;
  const clampedSouth = centerLat - maxDelta;
  const clampedNorth = centerLat + maxDelta;
  const clampedWest = centerLng - maxDelta;
  const clampedEast = centerLng + maxDelta;

  try {
    // Step 1 — get list of routes in the bounding box
    const listUrl = `https://hiking.waymarkedtrails.org/api/v1/list/by_area?bbox=${clampedWest},${clampedSouth},${clampedEast},${clampedNorth}&limit=20`;

    const listRes = await fetch(listUrl, {
      headers: { "Accept": "application/json" },
    });

    if (!listRes.ok) {
      return NextResponse.json({ error: "Waymarked Trails API error" }, { status: listRes.status });
    }

    const listData = await listRes.json();
    const routes = listData.results || [];

    // Step 2 — fetch geometry for each route in parallel
    const trails = await Promise.all(
      routes.map(async (route: { id: number; name: string; ref?: string; itinerary?: string }) => {
        try {
          const geoRes = await fetch(
            `https://hiking.waymarkedtrails.org/api/v1/details/relation/${route.id}/geometry/geojson`
          );
          if (!geoRes.ok) return null;
          const geo = await geoRes.json();

          const segments: number[][][] = [];

          if (geo.type === "LineString") {
            segments.push(geo.coordinates);
          } else if (geo.type === "MultiLineString") {
            segments.push(...geo.coordinates);
          } else if (geo.type === "GeometryCollection") {
            geo.geometries?.forEach((g: { type: string; coordinates: number[][] | number[][][] }) => {
              if (g.type === "LineString") segments.push(g.coordinates as number[][]);
              if (g.type === "MultiLineString") segments.push(...(g.coordinates as number[][][]));
            });
          }

          return {
            id: route.id,
            name: route.name || route.ref || "Unnamed trail",
            distance: null,
            ascent: null,
            difficulty: null,
            description: route.itinerary || null,
            osm_url: `https://www.openstreetmap.org/relation/${route.id}`,
            segments,
          };
        } catch {
          return null;
        }
      })
    );

    const validTrails = trails.filter((t) => t && t.segments.length > 0);
    return NextResponse.json(validTrails);

  } catch (error) {
    console.error("Waymarked Trails error:", error);
    return NextResponse.json({ error: "Failed to fetch trails" }, { status: 500 });
  }
}