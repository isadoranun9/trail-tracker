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

    const nodeMap: Record<number, { lat: number; lon: number }> = {};
    const wayMap: Record<number, number[]> = {};

    data.elements.forEach((el: OSMElement) => {
      if (el.type === "node") {
        nodeMap[el.id] = { lat: el.lat, lon: el.lon };
      }
      if (el.type === "way") {
        wayMap[el.id] = el.nodes;
      }
    });

    const trails = data.elements
      .filter((el: OSMElement) =>
        el.type === "relation" &&
        (el as OSMRelation).tags?.route === "hiking" &&
        (el as OSMRelation).tags?.name
      )
      .map((rel: OSMRelation) => {
        // Keep each way as a separate segment — no stitching
        const segments: number[][][] = rel.members
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