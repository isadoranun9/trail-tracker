export const revalidate = 3600;
import { NextResponse } from "next/server";

interface OSMNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface OSMWay {
  type: "way";
  id: number;
  nodes: number[];
  geometry?: { lat: number; lon: number }[];
}

interface OSMRelation {
    type: "relation";
    id: number;
    tags: Record<string, string>;
    members: {
      type: string;
      ref: number;
      role: string;
      geometry?: { lat: number; lon: number }[];
    }[];
  }

type OSMElement = OSMNode | OSMWay | OSMRelation;

async function fetchOverpass(query: string): Promise<Response> {
    const endpoints = [
        "https://overpass.openstreetmap.ru/cgi/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
      ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 50000);
      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) return response;
    } catch {
      console.log(`Endpoint ${endpoint} failed, trying next...`);
    }
  }
  throw new Error("All Overpass endpoints failed");
}

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

  // Use out geom to get geometry inline — much faster than resolving nodes separately
  const query = `
    [out:json][timeout:15];
    relation
      ["route"="hiking"]
      ["name"]
      (${clampedSouth},${clampedWest},${clampedNorth},${clampedEast});
    out geom tags;
  `;

  try {
    const response = await fetchOverpass(query);
    const data = await response.json();

    const trails = data.elements
      .filter((el: OSMElement) =>
        el.type === "relation" &&
        (el as OSMRelation).tags?.route === "hiking" &&
        (el as OSMRelation).tags?.name
      )
      .map((rel: OSMRelation) => {
      const segments: number[][][] = (rel.members || [])
          .filter((m) => m.type === "way" && m.geometry && m.geometry.length >= 2)
          .map((m) =>
            (m.geometry || []).map((pt) => [pt.lon, pt.lat])
          );

        return {
          id: rel.id,
          name: rel.tags.name,
          distance: rel.tags.distance || null,
          ascent: rel.tags.ascent || null,
          difficulty: rel.tags.sac_scale || null,
          description: rel.tags.description || null,
          osm_url: `https://www.openstreetmap.org/relation/${rel.id}`,
          segments,
        };
      })
      .filter((t: { segments: number[][][] }) => t.segments.length > 0);

    return NextResponse.json(trails);
  } catch (error) {
    console.error("Overpass error:", error);
    return NextResponse.json({ error: "Failed to fetch trails" }, { status: 500 });
  }
}