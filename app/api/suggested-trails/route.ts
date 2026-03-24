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
}

interface OSMRelation {
  type: "relation";
  id: number;
  tags: Record<string, string>;
  members: { type: string; ref: number; role: string }[];
}

type OSMElement = OSMNode | OSMWay | OSMRelation;

async function fetchOverpass(query: string): Promise<Response> {
    const endpoints = [
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass-api.de/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];
  
    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
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

  // Clamp the bounding box to max 1 degree in each direction
  // to avoid querying too large an area
  const centerLat = (north + south) / 2;
  const centerLng = (east + west) / 2;
  const maxDelta = 0.5;
  const clampedSouth = centerLat - maxDelta;
  const clampedNorth = centerLat + maxDelta;
  const clampedWest = centerLng - maxDelta;
  const clampedEast = centerLng + maxDelta;

  const query = `
    [out:json][timeout:20];
    relation
      ["route"="hiking"]
      ["name"]
      (${clampedSouth},${clampedWest},${clampedNorth},${clampedEast});
    out tags;
    out body;
    >;
    out skel qt;
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch("https://overpass.kumi.systems/api/interpreter", {      method: "POST",
      body: query,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json({ error: "Overpass API error" }, { status: response.status });
    }

    const data = await response.json();

    const nodeMap: Record<number, { lat: number; lon: number }> = {};
    const wayMap: Record<number, number[]> = {};

    data.elements.forEach((el: OSMElement) => {
      if (el.type === "node") {
        nodeMap[el.id] = { lat: (el as OSMNode).lat, lon: (el as OSMNode).lon };
      }
      if (el.type === "way") {
        wayMap[el.id] = (el as OSMWay).nodes;
      }
    });

    const trails = data.elements
      .filter((el: OSMElement) =>
        el.type === "relation" &&
        (el as OSMRelation).tags?.route === "hiking" &&
        (el as OSMRelation).tags?.name
      )
      .map((rel: OSMRelation) => {
        const segments: number[][][] = (rel.members || [])
  .filter((m) => m.type === "way")
          .map((m) => {
            const nodes = wayMap[m.ref] || [];
            return nodes
              .map((nodeId) => {
                const node = nodeMap[nodeId];
                return node ? [node.lon, node.lat] : null;
              })
              .filter(Boolean) as number[][];
          })
          .filter((coords) => coords.length >= 2);

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