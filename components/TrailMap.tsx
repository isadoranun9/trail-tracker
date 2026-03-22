"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import polyline from "@mapbox/polyline";
import "mapbox-gl/dist/mapbox-gl.css";

interface Activity {
  id: number;
  name: string;
  map: { summary_polyline: string };
  start_date: string;
  distance: number;
  total_elevation_gain: number;
  moving_time: number;
  elev_high: number;
  elev_low: number;
}

interface Filters {
  search: string;
  minDistance: string;
  maxDistance: string;
  minElevation: string;
  minTime: string;
  maxTime: string;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getHeatColor(count: number): string {
  if (count === 1) return "#2D6A4F";
  if (count === 2) return "#52B788";
  if (count === 3) return "#F4A261";
  return "#E63946";
}

function routesAreSimilar(coords1: number[][], coords2: number[][]): boolean {
  const THRESHOLD_DEG = 0.005;
  const SAMPLE_COUNT = 8;
  const step = Math.floor(coords1.length / SAMPLE_COUNT);
  let matches = 0;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const [lat1, lng1] = coords1[i * step] || coords1[0];
    const isClose = coords2.some(([lat2, lng2]) => {
      return (
        Math.abs(lat1 - lat2) < THRESHOLD_DEG &&
        Math.abs(lng1 - lng2) < THRESHOLD_DEG
      );
    });
    if (isClose) matches++;
  }

  return matches >= 6;
}

function applyFilters(activities: Activity[], filters: Filters): Activity[] {
  return activities.filter((a) => {
    const distKm = a.distance / 1000;
    const timeHours = a.moving_time / 3600;

    if (filters.search && !a.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.minDistance && distKm < parseFloat(filters.minDistance)) return false;
    if (filters.maxDistance && distKm > parseFloat(filters.maxDistance)) return false;
    if (filters.minElevation && a.total_elevation_gain < parseFloat(filters.minElevation)) return false;
    if (filters.minTime && timeHours < parseFloat(filters.minTime)) return false;
    if (filters.maxTime && timeHours > parseFloat(filters.maxTime)) return false;

    return true;
  });
}

const defaultFilters: Filters = {
  search: "",
  minDistance: "",
  maxDistance: "",
  minElevation: "",
  minTime: "",
  maxTime: "",
};

export default function TrailMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const hoveredId = useRef<number | null>(null);
  const repeatCounts = useRef<Record<number, number>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const filteredActivities = applyFilters(activities, filters);
  const activeFilterCount = Object.values(filters).filter((v) => v !== "").length;

  useEffect(() => {
    fetch("/api/activities")
      .then((r) => r.json())
      .then((data) => {
        setActivities(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!mapContainer.current || activities.length === 0) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-70.6, -33.4],
      zoom: 5,
    });

    map.current.on("load", () => {
      const decoded: Record<number, number[][]> = {};
      activities.forEach((a) => {
        if (a.map?.summary_polyline) {
          decoded[a.id] = polyline.decode(a.map.summary_polyline);
        }
      });

      const activityList = activities.filter((a) => decoded[a.id]?.length > 0);

      activityList.forEach((a) => {
        let count = 1;
        activityList.forEach((b) => {
          if (a.id === b.id) return;
          if (routesAreSimilar(decoded[a.id], decoded[b.id])) count++;
        });
        repeatCounts.current[a.id] = count;
      });

      activityList.forEach((activity) => {
        const coords = decoded[activity.id];
        const count = repeatCounts.current[activity.id];
        const color = getHeatColor(count);

        const geojson: GeoJSON.Feature = {
          type: "Feature",
          properties: {
            id: activity.id,
            name: activity.name,
            distance: (activity.distance / 1000).toFixed(1),
            elevation: activity.total_elevation_gain,
            duration: formatTime(activity.moving_time),
            date: new Date(activity.start_date).toLocaleDateString(),
            elev_high: Math.round(activity.elev_high),
            elev_low: Math.round(activity.elev_low),
            count,
            color,
          },
          geometry: {
            type: "LineString",
            coordinates: coords.map(([lat, lng]) => [lng, lat]),
          },
        };

        map.current!.addSource(`trail-${activity.id}`, {
          type: "geojson",
          data: geojson,
        });

        map.current!.addLayer({
          id: `trail-hit-${activity.id}`,
          type: "line",
          source: `trail-${activity.id}`,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "transparent", "line-width": 20 },
        });

        map.current!.addLayer({
          id: `trail-${activity.id}`,
          type: "line",
          source: `trail-${activity.id}`,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": 3,
            "line-opacity": 0.85,
          },
        });

        map.current!.on("click", `trail-hit-${activity.id}`, async (e) => {
            const props = e.features?.[0]?.properties;
            if (!props) return;
          
            if (hoveredId.current !== null) {
              map.current!.setPaintProperty(
                `trail-${hoveredId.current}`,
                "line-color",
                getHeatColor(repeatCounts.current[hoveredId.current])
              );
              map.current!.setPaintProperty(`trail-${hoveredId.current}`, "line-width", 3);
            }
          
            map.current!.setPaintProperty(`trail-${activity.id}`, "line-color", "#FFD700");
            map.current!.setPaintProperty(`trail-${activity.id}`, "line-width", 5);
            hoveredId.current = activity.id;
          
            // Show popup with loading state first
            const popup = new mapboxgl.Popup({ offset: 12, closeButton: true, maxWidth: "280px" })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font-family: sans-serif; min-width: 240px;">
                  <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${props.name}</div>
                  <div style="font-size: 12px; color: #555; line-height: 1.8;">
                    📅 ${props.date}<br/>
                    📏 ${props.distance} km<br/>
                    ⬆️ ${props.elevation}m gain<br/>
                    🏔️ Max: ${props.elev_high}m · Min: ${props.elev_low}m<br/>
                    ⏱️ ${props.duration}<br/>
                    🔁 Done ${props.count}x
                  </div>
                  <canvas id="elev-chart-${activity.id}" width="240" height="80" style="margin-top: 10px; width: 100%;"></canvas>
                  <button
                    id="strava-btn-${activity.id}"
                    style="display: inline-block; margin-top: 10px; padding: 6px 12px; background: #FC4C02; color: white; border-radius: 4px; border: none; font-size: 12px; font-weight: 600; cursor: pointer;"
                  >
                    View on Strava →
                  </button>
                </div>
              `)
              .addTo(map.current!);
          
            setTimeout(async () => {
              // Wire up Strava button
              const btn = document.getElementById(`strava-btn-${activity.id}`);
              if (btn) {
                btn.addEventListener("click", () => {
                  window.open(`https://www.strava.com/activities/${activity.id}`, "_blank");
                });
              }
          
              // Fetch elevation stream and draw chart
              try {
                const res = await fetch(`/api/activities/${activity.id}/stream`);
                const stream = await res.json();
          
                const altData: number[] = stream.altitude?.data ?? [];
                const distData: number[] = stream.distance?.data ?? [];
          
                if (altData.length === 0) return;
          
                const canvas = document.getElementById(`elev-chart-${activity.id}`) as HTMLCanvasElement;
                if (!canvas) return;
          
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
          
                const W = canvas.width;
                const H = canvas.height;
                const minAlt = Math.min(...altData);
                const maxAlt = Math.max(...altData);
                const range = maxAlt - minAlt || 1;
                const maxDist = distData[distData.length - 1] || 1;
          
                // Background
                ctx.fillStyle = "#f5f5f5";
                ctx.fillRect(0, 0, W, H);
          
                // Draw filled elevation area
                ctx.beginPath();
                ctx.moveTo(0, H);
          
                altData.forEach((alt, i) => {
                  const x = (distData[i] / maxDist) * W;
                  const y = H - ((alt - minAlt) / range) * (H - 10) - 5;
                  if (i === 0) ctx.lineTo(x, y);
                  else ctx.lineTo(x, y);
                });
          
                ctx.lineTo(W, H);
                ctx.closePath();
                ctx.fillStyle = "#52B788";
                ctx.fill();
          
                // Draw line on top
                ctx.beginPath();
                altData.forEach((alt, i) => {
                  const x = (distData[i] / maxDist) * W;
                  const y = H - ((alt - minAlt) / range) * (H - 10) - 5;
                  if (i === 0) ctx.moveTo(x, y);
                  else ctx.lineTo(x, y);
                });
                ctx.strokeStyle = "#2D6A4F";
                ctx.lineWidth = 1.5;
                ctx.stroke();
          
                // Min/max labels
                ctx.fillStyle = "#555";
                ctx.font = "9px sans-serif";
                ctx.fillText(`${Math.round(minAlt)}m`, 2, H - 2);
                ctx.fillText(`${Math.round(maxAlt)}m`, 2, 10);
          
              } catch (err) {
                console.error("Failed to load elevation stream", err);
              }
            }, 100);
          
            setSelected(activity.id);
          });

        map.current!.on("mouseenter", `trail-hit-${activity.id}`, () => {
          map.current!.getCanvas().style.cursor = "pointer";
        });

        map.current!.on("mouseleave", `trail-hit-${activity.id}`, () => {
          map.current!.getCanvas().style.cursor = "";
        });
      });

      setMapReady(true);
    });

    return () => map.current?.remove();
  }, [activities]);

  // Show/hide trails on map based on filters
  useEffect(() => {
    if (!mapReady || !map.current) return;
    const filteredIds = new Set(filteredActivities.map((a) => a.id));
    activities.forEach((a) => {
      const visible = filteredIds.has(a.id);
      if (map.current!.getLayer(`trail-${a.id}`)) {
        map.current!.setLayoutProperty(
          `trail-${a.id}`,
          "visibility",
          visible ? "visible" : "none"
        );
        map.current!.setLayoutProperty(
          `trail-hit-${a.id}`,
          "visibility",
          visible ? "visible" : "none"
        );
      }
    });
  }, [filters, mapReady, activities, filteredActivities]);

  const handleSelectActivity = (activity: Activity) => {
    setSelected(activity.id);

    if (!mapReady || !map.current) return;

    if (hoveredId.current !== null) {
      map.current.setPaintProperty(
        `trail-${hoveredId.current}`,
        "line-color",
        getHeatColor(repeatCounts.current[hoveredId.current])
      );
      map.current.setPaintProperty(`trail-${hoveredId.current}`, "line-width", 3);
    }

    map.current.setPaintProperty(`trail-${activity.id}`, "line-color", "#FFD700");
    map.current.setPaintProperty(`trail-${activity.id}`, "line-width", 5);
    hoveredId.current = activity.id;

    if (!activity.map?.summary_polyline) return;

    const coords = polyline.decode(activity.map.summary_polyline);
    if (coords.length === 0) return;

    const lats = coords.map(([lat]) => lat);
    const lngs = coords.map(([, lng]) => lng);

    const bounds = new mapboxgl.LngLatBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    );

    map.current.fitBounds(bounds, { padding: 80, duration: 1200 });
  };

  const inputStyle = {
    width: "100%",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid #444",
    background: "#1a1a1a",
    color: "white",
    fontSize: "12px",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    fontSize: "11px",
    opacity: 0.6,
    marginBottom: "4px",
    display: "block" as const,
  };

  return (
    <div style={{ display: "flex", height: "100vh", position: "relative" }}>

      {/* Sidebar toggle button */}
      <button
        onClick={() => {
          setSidebarOpen(!sidebarOpen);
          setTimeout(() => map.current?.resize(), 350);
        }}
        style={{
          position: "absolute",
          top: "10px",
          left: sidebarOpen ? "290px" : "10px",
          zIndex: 10,
          background: "#2D6A4F",
          color: "white",
          border: "none",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "16px",
          transition: "left 0.3s ease",
          boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
        }}
      >
        {sidebarOpen ? "◀" : "▶"}
      </button>

      {/* Filter toggle button */}
      <button
        onClick={() => setFilterOpen(!filterOpen)}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          zIndex: 10,
          background: activeFilterCount > 0 ? "#F4A261" : "#2D6A4F",
          color: "white",
          border: "none",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
          boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
        }}
      >
        {activeFilterCount > 0 ? `⚙️ Filters (${activeFilterCount})` : "⚙️ Filters"}
      </button>

      {/* Filter panel */}
      {filterOpen && (
        <div style={{
          position: "absolute",
          top: "50px",
          right: "10px",
          zIndex: 10,
          background: "#2a2a2a",
          color: "white",
          borderRadius: "12px",
          padding: "1rem",
          width: "240px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>Filter Trails</span>
            <button
              onClick={() => setFilters(defaultFilters)}
              style={{ fontSize: "11px", background: "none", border: "none", color: "#52B788", cursor: "pointer" }}
            >
              Clear all
            </button>
          </div>

          {/* Search */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={labelStyle}>Search by name</label>
            <input
              style={inputStyle}
              placeholder="e.g. Cerro, Tantauco..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>

          {/* Distance */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={labelStyle}>Distance (km)</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                style={{ ...inputStyle, width: "50%" }}
                placeholder="Min"
                type="number"
                value={filters.minDistance}
                onChange={(e) => setFilters({ ...filters, minDistance: e.target.value })}
              />
              <input
                style={{ ...inputStyle, width: "50%" }}
                placeholder="Max"
                type="number"
                value={filters.maxDistance}
                onChange={(e) => setFilters({ ...filters, maxDistance: e.target.value })}
              />
            </div>
          </div>

          {/* Elevation gain */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={labelStyle}>Min elevation gain (m)</label>
            <input
              style={inputStyle}
              placeholder="e.g. 500"
              type="number"
              value={filters.minElevation}
              onChange={(e) => setFilters({ ...filters, minElevation: e.target.value })}
            />
          </div>

          {/* Time */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={labelStyle}>Duration (hours)</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                style={{ ...inputStyle, width: "50%" }}
                placeholder="Min"
                type="number"
                value={filters.minTime}
                onChange={(e) => setFilters({ ...filters, minTime: e.target.value })}
              />
              <input
                style={{ ...inputStyle, width: "50%" }}
                placeholder="Max"
                type="number"
                value={filters.maxTime}
                onChange={(e) => setFilters({ ...filters, maxTime: e.target.value })}
              />
            </div>
          </div>

          <div style={{ fontSize: "11px", opacity: 0.5, textAlign: "center" }}>
            Showing {filteredActivities.length} of {activities.length} hikes
          </div>
        </div>
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{ width: "280px", overflowY: "auto", padding: "1rem", background: "#1a1a1a", color: "white", flexShrink: 0 }}>
          <h2 style={{ marginBottom: "0.5rem" }}>🥾 My Trails</h2>

          <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#2a2a2a", borderRadius: "8px", fontSize: "11px" }}>
            <div style={{ marginBottom: "4px", opacity: 0.7 }}>Trail frequency</div>
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              {["#2D6A4F", "#52B788", "#F4A261", "#E63946"].map((c) => (
                <div key={c} style={{ width: "30px", height: "8px", background: c, borderRadius: "2px" }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2px", opacity: 0.5 }}>
              <span>once</span><span>often</span>
            </div>
          </div>

          {loading && <p style={{ opacity: 0.5 }}>Loading trails...</p>}
          {filteredActivities.map((a) => (
            <div
              key={a.id}
              onClick={() => handleSelectActivity(a)}
              style={{
                padding: "0.75rem",
                marginBottom: "0.5rem",
                background: selected === a.id ? "#2D6A4F" : "#2a2a2a",
                borderRadius: "8px",
                cursor: "pointer",
                borderLeft: selected === a.id ? "3px solid #52B788" : "3px solid transparent",
              }}
            >
              <div style={{ fontWeight: 500 }}>{a.name}</div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                {(a.distance / 1000).toFixed(1)} km · {a.total_elevation_gain}m gain
              </div>
              <div style={{ fontSize: "12px", opacity: 0.5 }}>
                {new Date(a.start_date).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Map */}
      <div ref={mapContainer} style={{ flex: 1 }} />
    </div>
  );
}