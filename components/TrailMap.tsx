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

export default function TrailMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const hoveredId = useRef<number | null>(null);
  const repeatCounts = useRef<Record<number, number>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
      style: "mapbox://styles/mapbox/outdoors-v12",
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
          if (routesAreSimilar(decoded[a.id], decoded[b.id])) {
            count++;
          }
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

        map.current!.on("click", `trail-hit-${activity.id}`, (e) => {
          const props = e.features?.[0]?.properties;
          if (!props) return;

          if (hoveredId.current !== null) {
            map.current!.setPaintProperty(
              `trail-${hoveredId.current}`,
              "line-color",
              getHeatColor(repeatCounts.current[hoveredId.current])
            );
            map.current!.setPaintProperty(
              `trail-${hoveredId.current}`,
              "line-width",
              3
            );
          }

          map.current!.setPaintProperty(`trail-${activity.id}`, "line-color", "#FFFFFF");
          map.current!.setPaintProperty(`trail-${activity.id}`, "line-width", 5);
          hoveredId.current = activity.id;

          const popup = new mapboxgl.Popup({ offset: 12, closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family: sans-serif; min-width: 200px;">
                <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${props.name}</div>
                <div style="font-size: 12px; color: #555; line-height: 1.8;">
                  📅 ${props.date}<br/>
                  📏 ${props.distance} km<br/>
                  ⬆️ ${props.elevation}m gain<br/>
                  🏔️ Max: ${props.elev_high}m · Min: ${props.elev_low}m<br/>
                  ⏱️ ${props.duration}<br/>
                  🔁 Done ${props.count}x
                </div>
                <button
                  id="strava-btn-${activity.id}"
                  style="display: inline-block; margin-top: 10px; padding: 6px 12px; background: #FC4C02; color: white; border-radius: 4px; border: none; font-size: 12px; font-weight: 600; cursor: pointer;"
                >
                  View on Strava →
                </button>
              </div>
            `)
            .addTo(map.current!);

          setTimeout(() => {
            const btn = document.getElementById(`strava-btn-${activity.id}`);
            if (btn) {
              btn.addEventListener("click", () => {
                window.open(`https://www.strava.com/activities/${activity.id}`, "_blank");
              });
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
    });

    return () => map.current?.remove();
  }, [activities]);

  const handleSelectActivity = (activity: Activity) => {
    setSelected(activity.id);

    if (hoveredId.current !== null && map.current) {
      map.current.setPaintProperty(
        `trail-${hoveredId.current}`,
        "line-color",
        getHeatColor(repeatCounts.current[hoveredId.current])
      );
      map.current.setPaintProperty(`trail-${hoveredId.current}`, "line-width", 3);
    }

    if (map.current) {
      map.current.setPaintProperty(`trail-${activity.id}`, "line-color", "#FFFFFF");
      map.current.setPaintProperty(`trail-${activity.id}`, "line-width", 5);
      hoveredId.current = activity.id;
    }

    if (!activity.map?.summary_polyline) return;

    const coords = polyline.decode(activity.map.summary_polyline);
    if (coords.length === 0) return;

    const lats = coords.map(([lat]) => lat);
    const lngs = coords.map(([, lng]) => lng);

    const bounds = new mapboxgl.LngLatBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    );

    map.current?.fitBounds(bounds, { padding: 80, duration: 1200 });
  };

  return (
    <div style={{ display: "flex", height: "100vh", position: "relative" }}>

      {/* Toggle button */}
      <button
        onClick={() => {
            setSidebarOpen(!sidebarOpen);
            setTimeout(() => {
              map.current?.resize();
            }, 350);
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
          {activities.map((a) => (
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