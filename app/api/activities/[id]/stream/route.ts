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

function stitchWays(wayCoords: number[][][]): number[][] {
  if (wayCoords.length === 0) return [];
  if (wayCoords.length === 1) return wayCoords[0];

  const result = [...wayCoords[0]];
  const remaining = wayCoords.slice(1);

  while (remaining.length > 0) {
    const lastPoint = result[result.length - 1];
    let bestIndex = -1;
    let bestReverse = false;
    let bestDist = Infinity;

    // Find the next way that connects to the current end point
    remaining.forEach((way, i) => {
      const firstPoint = way[0];
      const lastWayPoint = way[way.length - 1];

      const distToFirst = Math.abs(lastPoint[0] - firstPoint[0]) + Math.abs(lastPoint[1] - firstPoint[1]);
      const distToLast = Math.abs(lastPoint[0] - lastWayPoint[0]) + Math.abs(lastPoint[1] - lastWayPoint[1]);

      if (distToFirst < bestDist) {
        bestDist = distToFirst;
        bestIndex = i;
        bestReverse = false;
      }
      if (distToLast < bestDist) {
        bestDist = distToLast;
        bestIndex = i;
        bestReverse = true;
      }
    });

    if (bestIndex === -1) break;

    const nextWay = remaining.splice(bestIndex, 1)[0];
    const coords = bestReverse ? [...nextWay].reverse() : nextWay;

    // Only connect if reasonably close (within ~2km), otherwise start new segment
    if (bestDist < 0.02) {
      result.push(...coords.slice(1));
    } else {
      // Gap too large — skip this disconnected segment
      break;
    }
  }

  return result;
}

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
        // Build individual way coordinate arrays
        const wayCoords: number[][][] = rel.members
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

        // Stitch ways together properly
        const coordinates = stitchWays(wayCoords);

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