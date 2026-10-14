// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { layers as basemapLayers, namedFlavor } from '@protomaps/basemaps';
import { useSimulation, WINDHOEK_LOCATIONS } from '../context/SimulationContext';
import { Search } from 'lucide-react';

// Self-hosted Protomaps vector tiles for Windhoek (extracted from the public Protomaps
// build with `pmtiles extract`, see README). Override with VITE_PMTILES_URL to use another archive.
const PMTILES_URL: string = import.meta.env.VITE_PMTILES_URL
  || new URL(`${import.meta.env.BASE_URL}tiles/windhoek.pmtiles`, window.location.href).href;
const GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const TILE_ATTRIBUTION = '<a href="https://github.com/protomaps/basemaps" target="_blank">Protomaps</a> &copy; <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a>';

// [lng, lat] bounds of the extract, used to keep the camera inside available data
const MAX_BOUNDS: [[number, number], [number, number]] = [[16.7, -23.0], [17.4, -22.3]];
const WINDHOEK_CENTER: [number, number] = [17.0658, -22.5609]; // [lng, lat]

let protocolRegistered = false;
const registerPmtilesProtocol = () => {
  if (protocolRegistered) return;
  maplibregl.setWorkerUrl(maplibreWorkerUrl);
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocolRegistered = true;
};

const buildStyle = (isDark: boolean) => ({
  version: 8 as const,
  glyphs: GLYPHS_URL,
  sources: {
    protomaps: {
      type: 'vector' as const,
      url: `pmtiles://${PMTILES_URL}`,
      attribution: TILE_ATTRIBUTION,
    },
  },
  layers: basemapLayers('protomaps', namedFlavor(isDark ? 'dark' : 'light'), { lang: 'en' }),
});

const MAP_LOAD_TIMEOUT_MS = 12000;
const ROUTES_SOURCE = 'orbit-routes';
const ROUTES_LAYER = 'orbit-routes-line';

// Helper to calculate angle between two coordinates (for rotating cars)
const getAngle = (from, to) => {
  if (!from || !to) return 0;
  const dy = to[0] - from[0];
  const dx = to[1] - from[1];
  let theta = Math.atan2(dy, dx);
  theta *= 180 / Math.PI;
  return -theta + 90;
};

// Build a DOM element for a maplibre Marker from an HTML snippet
const markerElement = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
};

const toLngLat = (coords: number[]): [number, number] => [coords[1], coords[0]];

export default function MapView({
  height = '100%',
  width = '100%',
  showLocations = true,
  zoomControl = true,
  fitRideId = null,
  onMapClick = null,
  customPickupCoords = null,
  customDropoffCoords = null
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false); // basemap tiles could not be fetched
  const [retryKey, setRetryKey] = useState(0);

  // Refs for tracking markers so they are updated instead of re-created
  const driverMarkersRef = useRef({});
  const passengerMarkerRef = useRef(null);
  const locationMarkersRef = useRef([]);
  const customPickupMarkerRef = useRef(null);
  const customDropoffMarkerRef = useRef(null);
  const onMapClickRef = useRef(onMapClick);

  const { drivers, passenger, rides } = useSimulation();

  // Map Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // 1. Initialize MapLibre map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    registerPmtilesProtocol();
    const isDark = document.body.classList.contains('dark-theme');
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: buildStyle(isDark),
      center: WINDHOEK_CENTER,
      zoom: 11,
      minZoom: 8,
      maxZoom: 17,
      maxBounds: MAX_BOUNDS,
      attributionControl: { compact: true },
    });

    if (zoomControl) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }

    map.on('click', (e) => {
      if (onMapClickRef.current) {
        onMapClickRef.current([e.lngLat.lat, e.lngLat.lng]);
      }
    });

    // Tile/source failures (offline, the .pmtiles file missing) would otherwise leave a blank grey box
    map.on('error', (e) => {
      if (e && e.sourceId === 'protomaps') setMapError(true);
    });
    map.on('sourcedata', (e) => {
      if (e.sourceId === 'protomaps' && e.isSourceLoaded) setMapError(false);
    });

    // Some failures (e.g. the server answers with an HTML page instead of tiles) never raise an error event;
    // the style just never finishes loading. Treat a map that is not up after a while as failed.
    const loadTimeout = setTimeout(() => {
      if (!map.loaded()) setMapError(true);
    }, MAP_LOAD_TIMEOUT_MS);

    map.on('load', () => {
      clearTimeout(loadTimeout);
      map.addSource(ROUTES_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: ROUTES_LAYER,
        type: 'line',
        source: ROUTES_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8 },
      });
      setMapReady(true);
    });

    mapRef.current = map;

    // Keep the canvas correct when the container resizes (layout mode changes)
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(mapContainerRef.current);

    return () => {
      clearTimeout(loadTimeout);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      driverMarkersRef.current = {};
      passengerMarkerRef.current = null;
      locationMarkersRef.current = [];
      customPickupMarkerRef.current = null;
      customDropoffMarkerRef.current = null;
      setMapReady(false);
    };
  }, [zoomControl, retryKey]);

  // 2. Draw Static Predefined Locations
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    locationMarkersRef.current.forEach(m => m.remove());
    locationMarkersRef.current = [];
    if (!showLocations) return;

    WINDHOEK_LOCATIONS.forEach(loc => {
      const el = markerElement(`
        <div title="${loc.name}" style="
          width: 8px; height: 8px; border-radius: 50%;
          background: rgba(255,255,255,0.4);
          border: 1px solid rgba(255,255,255,0.8);
          box-shadow: 0 0 6px rgba(255,255,255,0.5);
        "></div>`);
      locationMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat(toLngLat(loc.coords)).addTo(map)
      );
    });
  }, [mapReady, showLocations]);

  // 3. Keep Passenger Marker Updated
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (passenger && passenger.coords) {
      const html = `
        <div class="marker-passenger-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00f2fe" stroke-width="2.5">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>`;

      if (!passengerMarkerRef.current) {
        passengerMarkerRef.current = new maplibregl.Marker({ element: markerElement(html) })
          .setLngLat(toLngLat(passenger.coords)).addTo(map);
      } else {
        passengerMarkerRef.current.setLngLat(toLngLat(passenger.coords));
      }
    } else if (passengerMarkerRef.current) {
      passengerMarkerRef.current.remove();
      passengerMarkerRef.current = null;
    }
  }, [passenger, mapReady]);

  // 4. Keep Driver Markers Updated and Rotated
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const seen = {};

    drivers.forEach(driver => {
      if (driver.status === 'OFFLINE') return;

      seen[driver.id] = true;
      const prevMarker = driverMarkersRef.current[driver.id];

      let angle = 0;
      if (prevMarker) {
        const prev = prevMarker._prevCoords;
        if (prev[0] !== driver.coords[0] || prev[1] !== driver.coords[1]) {
          angle = getAngle(prev, driver.coords);
        } else {
          angle = prevMarker._lastAngle || 0;
        }
      }

      const color = driver.status === 'ONLINE_IDLE' ? '#00f5a0' : '#ff9f43';
      const html = `
        <div class="marker-car-icon" style="transform: rotate(${angle}deg); border-color: ${color}; box-shadow: 0 0 10px ${color};">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M7 10l2-6h6l2 6" />
            <circle cx="9" cy="17" r="1.5" fill="#fff" />
            <circle cx="15" cy="17" r="1.5" fill="#fff" />
          </svg>
        </div>`;

      let marker = prevMarker;
      if (!marker) {
        marker = new maplibregl.Marker({ element: markerElement(html) })
          .setLngLat(toLngLat(driver.coords)).addTo(map);
      } else {
        marker.setLngLat(toLngLat(driver.coords));
        marker.getElement().innerHTML = html;
      }
      marker._prevCoords = driver.coords;
      marker._lastAngle = angle;
      driverMarkersRef.current[driver.id] = marker;
    });

    Object.keys(driverMarkersRef.current).forEach(id => {
      if (!seen[id]) {
        driverMarkersRef.current[id].remove();
        delete driverMarkersRef.current[id];
      }
    });
  }, [drivers, mapReady]);

  // 5. Custom Pins for Pickup/Dropoff Selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const syncPin = (ref, coords, color, cls) => {
      if (!coords) {
        if (ref.current) {
          ref.current.remove();
          ref.current = null;
        }
        return;
      }
      if (!ref.current) {
        const el = markerElement(`
          <div class="${cls} animate-bounce" style="
            width: 14px; height: 14px; border-radius: 50%;
            background: ${color}; border: 2px solid #fff;
            box-shadow: 0 0 12px ${color};
          "></div>`);
        ref.current = new maplibregl.Marker({ element: el }).setLngLat(toLngLat(coords)).addTo(map);
      } else {
        ref.current.setLngLat(toLngLat(coords));
      }
    };

    syncPin(customPickupMarkerRef, customPickupCoords, '#10b981', 'marker-custom-pickup');
    syncPin(customDropoffMarkerRef, customDropoffCoords, '#ec4899', 'marker-custom-dropoff');
  }, [customPickupCoords, customDropoffCoords, mapReady]);

  // 6. Route Lines (one GeoJSON source holding every active ride)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const features = [];
    rides.forEach(ride => {
      if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED' || !ride.driverId) return;
      const remaining = ride.routePoints.slice(ride.currentRouteIndex);
      if (remaining.length < 2) return;
      features.push({
        type: 'Feature',
        properties: { color: ride.status === 'ACCEPTED' ? '#ff9f43' : '#00f2fe' },
        geometry: { type: 'LineString', coordinates: remaining.map(toLngLat) },
      });
    });

    map.getSource(ROUTES_SOURCE)?.setData({ type: 'FeatureCollection', features });
  }, [rides, mapReady]);

  // 7. Auto-Fit Bounds Camera Logic
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !fitRideId) return;

    const activeRideObj = rides.find(r => r.id === fitRideId);
    if (!activeRideObj) return;

    const coords = [];
    const driverObj = drivers.find(d => d.id === activeRideObj.driverId);
    if (driverObj) coords.push(driverObj.coords);

    if (activeRideObj.status === 'ACCEPTED') {
      coords.push(activeRideObj.pickupCoords);
    } else if (activeRideObj.status === 'IN_PROGRESS' || activeRideObj.status === 'ARRIVED') {
      coords.push(activeRideObj.dropoffCoords);
    }

    if (coords.length > 0) {
      const t = setTimeout(() => {
        if (!mapRef.current) return;
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach(pt => bounds.extend(toLngLat(pt)));
        mapRef.current.fitBounds(bounds, { padding: 30, maxZoom: 16, animate: false });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [fitRideId, rides, drivers, mapReady]);

  // Map Search Actions
  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const filtered = WINDHOEK_LOCATIONS.filter(loc =>
      loc.name.toLowerCase().includes(query.toLowerCase()) ||
      loc.type?.toLowerCase().includes(query.toLowerCase())
    );
    setSearchResults(filtered);
  };

  const handleSelectSearchResult = (result) => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearch(false);

    if (mapRef.current) {
      mapRef.current.jumpTo({ center: toLngLat(result.coords), zoom: 14 });
    }

    if (onMapClick) {
      onMapClick(result.coords, result.name);
    }
  };

  return (
    <div
      className="glass-panel animate-map-reveal animate-fade-in"
      style={{
        height,
        width,
        position: 'relative',
        isolation: 'isolate',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid var(--border-muted)'
      }}
    >
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%', backgroundColor: 'var(--bg-deep)' }}
      />

      {mapError && (
        <div role="alert" className="absolute inset-0 z-[600] flex flex-col items-center justify-center gap-2 p-4 text-center" style={{ background: 'var(--bg-deep)' }}>
          <p className="text-xs font-bold text-white">Map unavailable</p>
          <p className="text-[11px] text-text-muted max-w-[220px] leading-relaxed">
            We could not load the map. Check your connection and try again.
          </p>
          <button
            onClick={() => {
              setMapError(false);
              setRetryKey(k => k + 1);
            }}
            className="btn-secondary px-3 py-1.5 text-[11px] justify-center mt-1"
          >
            Try again
          </button>
        </div>
      )}

      {/* Floating Map Search Overlay */}
      {mapReady && onMapClick && (
        <div className="absolute top-2 left-2 z-[1000] flex flex-col gap-1 w-[200px] text-left animate-fade-in">
          <div className="flex items-center bg-black/75 backdrop-blur-md border border-white/10 rounded-lg px-2 py-1 gap-1.5 shadow-lg">
            <Search size={12} className="text-cyan-400 shrink-0" />
            <input
              type="text"
              placeholder="Search destinations..."
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => setShowSearch(true)}
              className="bg-transparent border-none text-[10px] text-white focus:outline-none w-full placeholder-white/30 p-0 font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                className="text-[10px] text-text-muted hover:text-white font-bold px-1"
              >
                ×
              </button>
            )}
          </div>

          {showSearch && searchResults.length > 0 && (
            <div className="bg-black/90 backdrop-blur-md border border-white/10 rounded-lg shadow-xl max-h-[120px] overflow-y-auto flex flex-col p-1 text-left">
              {searchResults.map(result => (
                <button
                  key={result.id}
                  onClick={() => handleSelectSearchResult(result)}
                  className="text-[9px] text-white/80 hover:text-white hover:bg-white/5 px-2 py-1.5 rounded transition-all truncate text-left"
                >
                  {result.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
