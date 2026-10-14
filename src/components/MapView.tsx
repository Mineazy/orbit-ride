// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSimulation, WINDHOEK_LOCATIONS } from '../context/SimulationContext';
import { Search } from 'lucide-react';

// OpenStreetMap-based tiles (CARTO basemaps) - free, no API key required.
const TILE_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const WINDHOEK_CENTER: [number, number] = [-22.5609, 17.0658];

// Helper to calculate angle between two coordinates (for rotating cars)
const getAngle = (from, to) => {
  if (!from || !to) return 0;
  const dy = to[0] - from[0];
  const dx = to[1] - from[1];
  let theta = Math.atan2(dy, dx);
  theta *= 180 / Math.PI;
  return -theta + 90;
};

const htmlIcon = (html: string) =>
  L.divIcon({ html, className: 'orbit-map-marker', iconSize: [0, 0], iconAnchor: [0, 0] });

// Wrapper centres the HTML on the marker coordinate
const centered = (inner: string) =>
  `<div style="position:absolute;transform:translate(-50%,-50%);">${inner}</div>`;

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

  // Refs for tracking markers and lines to update them instead of re-creating the map
  const driverMarkersRef = useRef({});
  const passengerMarkerRef = useRef(null);
  const locationLayerRef = useRef(null);
  const activePolylinesRef = useRef({});
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

  // 1. Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const isDark = document.body.classList.contains('dark-theme');
    const map = L.map(mapContainerRef.current, {
      center: WINDHOEK_CENTER,
      zoom: 13,
      zoomControl,
      attributionControl: true,
    });
    L.tileLayer(isDark ? TILE_URLS.dark : TILE_URLS.light, {
      attribution: TILE_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (e) => {
      if (onMapClickRef.current) {
        onMapClickRef.current([e.latlng.lat, e.latlng.lng]);
      }
    });

    mapRef.current = map;
    setMapReady(true);

    // Keep tiles correct when the container resizes (layout mode changes)
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(mapContainerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      driverMarkersRef.current = {};
      passengerMarkerRef.current = null;
      locationLayerRef.current = null;
      activePolylinesRef.current = {};
      customPickupMarkerRef.current = null;
      customDropoffMarkerRef.current = null;
      setMapReady(false);
    };
  }, [zoomControl]);

  // 2. Draw Static Predefined Locations
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (locationLayerRef.current) {
      locationLayerRef.current.remove();
      locationLayerRef.current = null;
    }
    if (!showLocations) return;

    const layer = L.layerGroup();
    WINDHOEK_LOCATIONS.forEach(loc => {
      const html = centered(`
        <div title="${loc.name}" style="
          width: 8px; height: 8px; border-radius: 50%;
          background: rgba(255,255,255,0.4);
          border: 1px solid rgba(255,255,255,0.8);
          box-shadow: 0 0 6px rgba(255,255,255,0.5);
        "></div>`);
      L.marker(loc.coords, { icon: htmlIcon(html), interactive: false }).addTo(layer);
    });
    layer.addTo(map);
    locationLayerRef.current = layer;
  }, [mapReady, showLocations]);

  // 3. Keep Passenger Marker Updated
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (passenger && passenger.coords) {
      const icon = htmlIcon(centered(`
        <div class="marker-passenger-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00f2fe" stroke-width="2.5">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>`));

      if (!passengerMarkerRef.current) {
        passengerMarkerRef.current = L.marker(passenger.coords, { icon, interactive: false }).addTo(map);
      } else {
        passengerMarkerRef.current.setLatLng(passenger.coords).setIcon(icon);
      }
    } else if (passengerMarkerRef.current) {
      passengerMarkerRef.current.remove();
      passengerMarkerRef.current = null;
    }
  }, [passenger, mapReady]);

  // 4. Keep Driver Markers Updated and Rotated
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
      const icon = htmlIcon(centered(`
        <div class="marker-car-icon" style="transform: rotate(${angle}deg); border-color: ${color}; box-shadow: 0 0 10px ${color};">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M7 10l2-6h6l2 6" />
            <circle cx="9" cy="17" r="1.5" fill="#fff" />
            <circle cx="15" cy="17" r="1.5" fill="#fff" />
          </svg>
        </div>`));

      const marker = prevMarker || L.marker(driver.coords, { icon, interactive: false }).addTo(map);
      marker.setLatLng(driver.coords).setIcon(icon);
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
    if (!map) return;

    const syncPin = (ref, coords, color, cls) => {
      if (!coords) {
        if (ref.current) {
          ref.current.remove();
          ref.current = null;
        }
        return;
      }
      const icon = htmlIcon(centered(`
        <div class="${cls} animate-bounce" style="
          width: 14px; height: 14px; border-radius: 50%;
          background: ${color}; border: 2px solid #fff;
          box-shadow: 0 0 12px ${color};
        "></div>`));
      if (!ref.current) {
        ref.current = L.marker(coords, { icon, interactive: false }).addTo(map);
      } else {
        ref.current.setLatLng(coords).setIcon(icon);
      }
    };

    syncPin(customPickupMarkerRef, customPickupCoords, '#10b981', 'marker-custom-pickup');
    syncPin(customDropoffMarkerRef, customDropoffCoords, '#ec4899', 'marker-custom-dropoff');
  }, [customPickupCoords, customDropoffCoords, mapReady]);

  // 6. Route Polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = {};

    rides.forEach(ride => {
      if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED' || !ride.driverId) return;

      const remainingPoints = ride.routePoints.slice(ride.currentRouteIndex);
      if (remainingPoints.length === 0) return;

      seen[ride.id] = true;
      const color = ride.status === 'ACCEPTED' ? '#ff9f43' : '#00f2fe';

      if (!activePolylinesRef.current[ride.id]) {
        activePolylinesRef.current[ride.id] = L.polyline(remainingPoints, {
          color, weight: 4, opacity: 0.8, interactive: false,
        }).addTo(map);
      } else {
        activePolylinesRef.current[ride.id].setLatLngs(remainingPoints).setStyle({ color });
      }
    });

    Object.keys(activePolylinesRef.current).forEach(id => {
      if (!seen[id]) {
        activePolylinesRef.current[id].remove();
        delete activePolylinesRef.current[id];
      }
    });
  }, [rides, mapReady]);

  // 7. Auto-Fit Bounds Camera Logic
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitRideId) return;

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
        mapRef.current.invalidateSize();
        mapRef.current.fitBounds(L.latLngBounds(coords), { padding: [30, 30], maxZoom: 16, animate: false });
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
      mapRef.current.setView(result.coords, 14);
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
