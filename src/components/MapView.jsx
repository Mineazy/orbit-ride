import React, { useEffect, useRef, useState } from 'react';
import { useSimulation, WINDHOEK_LOCATIONS } from '../context/SimulationContext';
import { Search } from 'lucide-react';

// Safe check for window.L (Leaflet library loaded from CDN)
const getL = () => {
  return typeof window !== 'undefined' ? window.L : null;
};

// Helper to calculate angle between two coordinates (for rotating cars)
const getAngle = (from, to) => {
  if (!from || !to) return 0;
  const dy = to[0] - from[0];
  const dx = to[1] - from[1];
  let theta = Math.atan2(dy, dx); // range (-PI, PI]
  theta *= 180 / Math.PI; // rads to degs
  // Map Leaflet coordinate space to CSS rotation
  return -theta + 90; 
};

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
  
  // Refs for tracking markers to update them instead of re-creating the map
  const driverMarkersRef = useRef({});
  const passengerMarkerRef = useRef(null);
  const activePolylinesRef = useRef({});
  const locationMarkersRef = useRef([]);
  const customPickupMarkerRef = useRef(null);
  const customDropoffMarkerRef = useRef(null);

  const { drivers, passenger, rides, simulationSpeed } = useSimulation();
  const L = getL();

  // Map Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

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

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !L) return;

    // Centered on Windhoek, Namibia
    const map = L.map(mapContainerRef.current, {
      center: [-22.5609, 17.0658],
      zoom: 13,
      zoomControl: zoomControl,
      attributionControl: false
    });

    // Dark Matter basemap for premium cyberpunk command center look
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    mapRef.current = map;

    // Force immediate size recalculation
    setTimeout(() => {
      if (mapRef.current) mapRef.current.invalidateSize();
    }, 150);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [L]);

  // 2. Plot Static Predefined Locations
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !L || !showLocations) return;

    // Clean previous location markers
    locationMarkersRef.current.forEach(marker => marker.remove());
    locationMarkersRef.current = [];

    WINDHOEK_LOCATIONS.forEach(loc => {
      const dotIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `
          <div style="
            width: 8px; 
            height: 8px; 
            border-radius: 50%; 
            background: rgba(255,255,255,0.4); 
            border: 1px solid rgba(255,255,255,0.8);
            box-shadow: 0 0 6px rgba(255,255,255,0.5);
          "></div>`,
        iconSize: [8, 8],
        iconAnchor: [4, 4]
      });

      const marker = L.marker(loc.coords, { icon: dotIcon })
        .bindTooltip(loc.name, { 
          permanent: false, 
          direction: 'top', 
          className: 'leaflet-tooltip-dark', 
          opacity: 0.8 
        })
        .addTo(map);

      locationMarkersRef.current.push(marker);
    });
  }, [L, showLocations, drivers]); // triggers once leaflet is ready

  // 3. Keep Passenger/Client Marker Updated
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !L) return;

    // Check passenger state
    if (passenger && passenger.coords) {
      const hasActiveRide = passenger.activeRideId !== null;
      
      const passIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `
          <div class="marker-passenger-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00f2fe" stroke-width="2.5">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      if (!passengerMarkerRef.current) {
        passengerMarkerRef.current = L.marker(passenger.coords, { icon: passIcon })
          .addTo(map)
          .bindPopup(`<b>Passenger: ${passenger.name}</b><br/>Rating: ⭐${passenger.rating}`);
      } else {
        passengerMarkerRef.current.setLatLng(passenger.coords);
      }
    } else {
      if (passengerMarkerRef.current) {
        passengerMarkerRef.current.remove();
        passengerMarkerRef.current = null;
      }
    }
  }, [passenger, L]);

  // 4. Keep Drivers Markers Updated and Rotated
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !L) return;

    const currentDriverIds = {};

    drivers.forEach(driver => {
      if (driver.status === 'OFFLINE') {
        // Remove marker if offline
        if (driverMarkersRef.current[driver.id]) {
          driverMarkersRef.current[driver.id].remove();
          delete driverMarkersRef.current[driver.id];
        }
        return;
      }

      currentDriverIds[driver.id] = true;
      const prevMarker = driverMarkersRef.current[driver.id];
      const prevCoords = prevMarker ? prevMarker.getLatLng() : null;
      
      // Calculate heading angle
      let angle = 0;
      if (prevCoords) {
        const pCoords = [prevCoords.lat, prevCoords.lng];
        if (pCoords[0] !== driver.coords[0] || pCoords[1] !== driver.coords[1]) {
          angle = getAngle(pCoords, driver.coords);
          // Store last valid angle on marker instance
          prevMarker._lastAngle = angle;
        } else {
          angle = prevMarker._lastAngle || 0;
        }
      }

      // Generate HTML with rotated car icon
      const carHtml = `
        <div class="marker-car-icon" style="transform: rotate(${angle}deg); border-color: ${
          driver.status === 'ONLINE_IDLE' ? '#00f5a0' : '#ff9f43'
        }; box-shadow: 0 0 10px ${
          driver.status === 'ONLINE_IDLE' ? '#00f5a0' : '#ff9f43'
        };">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M7 10l2-6h6l2 6" />
            <circle cx="9" cy="17" r="1.5" fill="#fff" />
            <circle cx="15" cy="17" r="1.5" fill="#fff" />
          </svg>
        </div>
      `;

      const driverIcon = L.divIcon({
        className: 'custom-div-icon',
        html: carHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      if (!prevMarker) {
        const marker = L.marker(driver.coords, { icon: driverIcon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: var(--font-sans)">
              <b style="color:var(--success)">Driver: ${driver.name}</b><br/>
              <span>Car: ${driver.car}</span><br/>
              <span>Tier: ${driver.tier}</span><br/>
              <span>Rating: ⭐${driver.rating}</span><br/>
              <span>Status: <b style="color:${driver.status === 'ONLINE_IDLE' ? '#00f5a0' : '#ff9f43'}">${driver.status}</b></span>
            </div>
          `);
        marker._lastAngle = angle;
        driverMarkersRef.current[driver.id] = marker;
      } else {
        prevMarker.setLatLng(driver.coords);
        prevMarker.setIcon(driverIcon);
      }
    });

    // Remove any markers of drivers that are no longer in the list
    Object.keys(driverMarkersRef.current).forEach(id => {
      if (!currentDriverIds[id]) {
        driverMarkersRef.current[id].remove();
        delete driverMarkersRef.current[id];
      }
    });
  }, [drivers, L]);

  // 4b. Map Click Event Listener Hook
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onMapClick || !L) return;

    const handleMapClick = (e) => {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [onMapClick, L]);

  // 4c. Plot Custom Pickup/Dropoff Pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !L) return;

    // Custom Pickup Pin (Green)
    if (customPickupCoords) {
      const pickupPinHtml = `
        <div class="marker-custom-pickup animate-bounce" style="
          width: 14px; 
          height: 14px; 
          border-radius: 50%; 
          background: #10b981; 
          border: 2px solid #fff;
          box-shadow: 0 0 12px #10b981;
        "></div>
      `;
      const pickupIcon = L.divIcon({
        className: 'custom-div-icon',
        html: pickupPinHtml,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      if (!customPickupMarkerRef.current) {
        customPickupMarkerRef.current = L.marker(customPickupCoords, { icon: pickupIcon })
          .addTo(map)
          .bindTooltip("Custom Pickup", { permanent: false, direction: 'top' });
      } else {
        customPickupMarkerRef.current.setLatLng(customPickupCoords);
      }
    } else {
      if (customPickupMarkerRef.current) {
        customPickupMarkerRef.current.remove();
        customPickupMarkerRef.current = null;
      }
    }

    // Custom Dropoff Pin (Pink)
    if (customDropoffCoords) {
      const dropoffPinHtml = `
        <div class="marker-custom-dropoff animate-bounce" style="
          width: 14px; 
          height: 14px; 
          border-radius: 50%; 
          background: #ec4899; 
          border: 2px solid #fff;
          box-shadow: 0 0 12px #ec4899;
        "></div>
      `;
      const dropoffIcon = L.divIcon({
        className: 'custom-div-icon',
        html: dropoffPinHtml,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      if (!customDropoffMarkerRef.current) {
        customDropoffMarkerRef.current = L.marker(customDropoffCoords, { icon: dropoffIcon })
          .addTo(map)
          .bindTooltip("Custom Dropoff", { permanent: false, direction: 'top' });
      } else {
        customDropoffMarkerRef.current.setLatLng(customDropoffCoords);
      }
    } else {
      if (customDropoffMarkerRef.current) {
        customDropoffMarkerRef.current.remove();
        customDropoffMarkerRef.current = null;
      }
    }
  }, [customPickupCoords, customDropoffCoords, L]);

  // 5. Draw active routes paths
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !L) return;

    const currentRideIds = {};

    rides.forEach(ride => {
      if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED' || !ride.driverId) {
        // Clean polyline if completed/cancelled or no driver assigned
        if (activePolylinesRef.current[ride.id]) {
          activePolylinesRef.current[ride.id].remove();
          delete activePolylinesRef.current[ride.id];
        }
        return;
      }

      currentRideIds[ride.id] = true;
      const remainingPoints = ride.routePoints.slice(ride.currentRouteIndex);

      if (remainingPoints.length > 0) {
        const strokeColor = ride.status === 'ACCEPTED' ? '#ff9f43' : '#00f2fe'; // Amber for pickup, Cyan for trip
        const polylineOptions = {
          color: strokeColor,
          weight: 4,
          opacity: 0.8,
          lineJoin: 'round',
          className: 'route-path-flow' // CSS animated dashed flow
        };

        if (!activePolylinesRef.current[ride.id]) {
          const polyline = L.polyline(remainingPoints, polylineOptions).addTo(map);
          activePolylinesRef.current[ride.id] = polyline;
        } else {
          activePolylinesRef.current[ride.id].setLatLngs(remainingPoints);
          activePolylinesRef.current[ride.id].setStyle({ color: strokeColor });
        }
      }
    });

    // Clean obsolete paths
    Object.keys(activePolylinesRef.current).forEach(id => {
      if (!currentRideIds[id]) {
        activePolylinesRef.current[id].remove();
        delete activePolylinesRef.current[id];
      }
    });
  }, [rides, L]);

  // 6. Camera Auto-Fit logic
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !L || !fitRideId) return;

    const activeRideObj = rides.find(r => r.id === fitRideId);
    if (!activeRideObj) return;

    const coords = [];
    const driverObj = drivers.find(d => d.id === activeRideObj.driverId);
    if (driverObj) {
      coords.push(driverObj.coords);
    }

    if (activeRideObj.status === 'ACCEPTED') {
      coords.push(activeRideObj.pickupCoords);
    } else if (activeRideObj.status === 'IN_PROGRESS' || activeRideObj.status === 'ARRIVED') {
      coords.push(activeRideObj.dropoffCoords);
    }

    if (coords.length > 0) {
      setTimeout(() => {
        if (!mapRef.current) return;
        mapRef.current.invalidateSize();
        try {
          const bounds = L.latLngBounds(coords);
          mapRef.current.fitBounds(bounds, { padding: [25, 25], maxZoom: 15 });
        } catch (e) {
          console.error('Fit bounds error:', e);
        }
      }, 100);
    }
  }, [fitRideId, rides, drivers, L]);

  // Auto-resize map when sizes shift
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        if (mapRef.current) mapRef.current.invalidateSize();
      }, 250);
    }
  }, [height, width]);

  return (
    <div 
      className="glass-panel animate-map-reveal animate-fade-in"
      style={{ 
        height, 
        width, 
        position: 'relative', 
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)'
      }}
    >
      <div 
        ref={mapContainerRef} 
        style={{ width: '100%', height: '100%' }}
      />
      
      {/* Floating Map Search Overlay */}
      {onMapClick && (
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
