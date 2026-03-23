import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const north = searchParams.get("north");
  const south = searchParams.get("south");
  const east = searchParams.get("east");
  const west = searchParams.get("west");

  if (!north || !south || !east || !west) {
    return NextResponse.json({ error: "Missing bounds" }, { status: 400 });
  }

  const query = `
    [out:json][timeout:30];
    relation
      ["route"="hiking"]
      ["name"]
      (${south},${west},${north},${east});
    out body;
    >;
    out skel qt;
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Overpass API error" }, { status: response.status });
    }

    const data = await response.json();

    // Parse OSM relations into GeoJSON-like features
    const nodeMap: Record<number, { lat: number; lon: number }> = {};
    const wayMap: Record<number, number[]> = {};

    data.elements.forEach((el: { type: string; id: number; lat?: number; lon?: number; nodes?: number[] }) => {
      if (el.type === "node" && el.lat && el.lon) {
        nodeMap[el.id] = { lat: el.lat, lon: el.lon };
      }
      if (el.type === "way" && el.nodes) {
        wayMap[el.id] = el.nodes;
      }
    });

    const trails = data.elements
      .filter((el: { type: string; tags?: Record<string, string>; members?: { type: string; ref: number }[] }) =>
        el.type === "relation" && el.tags?.route === "hiking" && el.tags?.name
      )
      .map((rel: { id: number; tags: Record<string, string>; members: { type: string; ref: number }[] }) => {
        // Build coordinates from member ways
        const coordinates: number[][] = [];
        rel.members
          .filter((m) => m.type === "way")
          .forEach((m) => {
            const nodes = wayMap[m.ref] || [];
            nodes.forEach((nodeId) => {
              const node = nodeMap[nodeId];
              if (node) coordinates.push([node.lon, node.lat]);
            });
          });

        return {
          id: rel.id,
          name: rel.tags.name,
          distance: rel.tags.distance || null,
          ascent: rel.tags.ascent || null,
          difficulty: rel.tags.sac_scale || null,
          description: rel.tags.description || null,
          osm_url: `https://www.openstreetmap.org/relation/${rel.id}`,
          coordinates,
        };
      })
      .filter((t: { coordinates: number[][] }) => t.coordinates.length > 1);

    return NextResponse.json(trails);
  } catch (error) {
    console.error("Overpass error:", error);
    return NextResponse.json({ error: "Failed to fetch trails" }, { status: 500 });
  }
}