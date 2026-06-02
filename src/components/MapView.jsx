import React, { useEffect, useRef, useState } from 'react';
import { useSimulation, WINDHOEK_LOCATIONS } from '../context/SimulationContext';
import { Search } from 'lucide-react';

// Custom Dark Map Style for Google Maps (Cyberpunk neon dashboard aesthetic)
const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#0d0e15" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0d0e15" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#747890" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1b1d2a" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#181a26" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#222536" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1c1e2d" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#07080d" }],
  },
  {
    featureType: "poi",
    elementType: "all",
    stylers: [{ visibility: "off" }]
  },
  {
    featureType: "transit",
    elementType: "all",
    stylers: [{ visibility: "off" }]
  }
];

// Helper to calculate angle between two coordinates (for rotating cars)
const getAngle = (from, to) => {
  if (!from || !to) return 0;
  const dy = to[0] - from[0];
  const dx = to[1] - from[1];
  let theta = Math.atan2(dy, dx);
  theta *= 180 / Math.PI;
  return -theta + 90; 
};

// Global cache to load script only once across matrix/multi-instance setups
let scriptLoadingPromise = null;

const loadGoogleMapsScript = (apiKey) => {
  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    // Set callback function on window for Google Maps to trigger when loaded
    window.initGoogleMapCallback = () => {
      resolve();
      try {
        delete window.initGoogleMapCallback;
      } catch (e) {
        window.initGoogleMapCallback = undefined;
      }
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&loading=async&callback=initGoogleMapCallback`;
    script.async = true;
    script.defer = true;
    script.onerror = (err) => {
      reject(err);
      try {
        delete window.initGoogleMapCallback;
      } catch (e) {
        window.initGoogleMapCallback = undefined;
      }
    };
    document.head.appendChild(script);
  });

  return scriptLoadingPromise;
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
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Refs for tracking markers and lines to update them instead of re-creating the map
  const driverMarkersRef = useRef({});
  const passengerMarkerRef = useRef(null);
  const locationMarkersRef = useRef([]);
  const activePolylinesRef = useRef({});
  const customPickupMarkerRef = useRef(null);
  const customDropoffMarkerRef = useRef(null);
  
  // Custom HTML Marker overlay constructor ref
  const HTMLMarkerClassRef = useRef(null);

  const { drivers, passenger, rides, simulationSpeed } = useSimulation();

  // Map Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

  // 1. Load Google Maps script dynamically
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    loadGoogleMapsScript(apiKey)
      .then(() => {
        // Define Custom HTMLMarker class when google maps namespace is loaded
        if (!HTMLMarkerClassRef.current && window.google) {
          class HTMLMarker extends window.google.maps.OverlayView {
            constructor(latlng, html, map) {
              super();
              this.latlng = latlng;
              this.html = html;
              this.div = null;
              this.setMap(map);
            }
            onAdd() {
              this.div = document.createElement('div');
              this.div.style.position = 'absolute';
              this.div.style.transform = 'translate(-50%, -50%)';
              this.div.innerHTML = this.html;
              const panes = this.getPanes();
              panes.overlayMouseTarget.appendChild(this.div);
            }
            draw() {
              if (!this.div) return;
              const overlayProjection = this.getProjection();
              const position = overlayProjection.fromLatLngToDivPixel(this.latlng);
              this.div.style.left = position.x + 'px';
              this.div.style.top = position.y + 'px';
            }
            onRemove() {
              if (this.div) {
                if (this.div.parentNode) {
                  this.div.parentNode.removeChild(this.div);
                }
                this.div = null;
              }
            }
            setPosition(latlng) {
              this.latlng = latlng;
              this.draw();
            }
            setHtml(html) {
              this.html = html;
              if (this.div) this.div.innerHTML = html;
            }
          }
          HTMLMarkerClassRef.current = HTMLMarker;
        }
        setMapsLoaded(true);
      })
      .catch((err) => {
        console.error("Google Maps failed to load", err);
        setLoadError(true);
      });
  }, []);

  // 2. Initialize Google Map
  useEffect(() => {
    if (!mapsLoaded || !mapContainerRef.current || mapRef.current || !window.google) return;

    const map = new window.google.maps.Map(mapContainerRef.current, {
      center: { lat: -22.5609, lng: 17.0658 },
      zoom: 13,
      styles: darkMapStyle,
      disableDefaultUI: true,
      zoomControl: zoomControl,
      gestureHandling: 'cooperative'
    });

    mapRef.current = map;

    // Register Map Click Listener
    map.addListener('click', (e) => {
      if (onMapClick) {
        onMapClick([e.latLng.lat(), e.latLng.lng()]);
      }
    });

    return () => {
      // Cleanup map references
      if (mapRef.current) {
        mapRef.current = null;
      }
    };
  }, [mapsLoaded]);

  // 3. Draw Static Predefined Locations
  useEffect(() => {
    const map = mapRef.current;
    const HTMLMarker = HTMLMarkerClassRef.current;
    if (!map || !HTMLMarker || !showLocations) return;

    // Clean previous location markers
    locationMarkersRef.current.forEach(marker => marker.setMap(null));
    locationMarkersRef.current = [];

    WINDHOEK_LOCATIONS.forEach(loc => {
      const html = `
        <div class="custom-div-icon" title="${loc.name}" style="
          width: 8px; 
          height: 8px; 
          border-radius: 50%; 
          background: rgba(255,255,255,0.4); 
          border: 1px solid rgba(255,255,255,0.8);
          box-shadow: 0 0 6px rgba(255,255,255,0.5);
          cursor: pointer;
        "></div>
      `;

      const latlng = new window.google.maps.LatLng(loc.coords[0], loc.coords[1]);
      const marker = new HTMLMarker(latlng, html, map);
      locationMarkersRef.current.push(marker);
    });
  }, [mapsLoaded, showLocations]);

  // 4. Keep Passenger Marker Updated
  useEffect(() => {
    const map = mapRef.current;
    const HTMLMarker = HTMLMarkerClassRef.current;
    if (!map || !HTMLMarker) return;

    if (passenger && passenger.coords) {
      const passHtml = `
        <div class="marker-passenger-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00f2fe" stroke-width="2.5">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      `;

      const latlng = new window.google.maps.LatLng(passenger.coords[0], passenger.coords[1]);

      if (!passengerMarkerRef.current) {
        passengerMarkerRef.current = new HTMLMarker(latlng, passHtml, map);
      } else {
        passengerMarkerRef.current.setPosition(latlng);
        passengerMarkerRef.current.setHtml(passHtml);
      }
    } else {
      if (passengerMarkerRef.current) {
        passengerMarkerRef.current.setMap(null);
        passengerMarkerRef.current = null;
      }
    }
  }, [passenger, mapsLoaded]);

  // 5. Keep Driver Markers Updated and Rotated
  useEffect(() => {
    const map = mapRef.current;
    const HTMLMarker = HTMLMarkerClassRef.current;
    if (!map || !HTMLMarker) return;

    const currentDriverIds = {};

    drivers.forEach(driver => {
      if (driver.status === 'OFFLINE') {
        if (driverMarkersRef.current[driver.id]) {
          driverMarkersRef.current[driver.id].setMap(null);
          delete driverMarkersRef.current[driver.id];
        }
        return;
      }

      currentDriverIds[driver.id] = true;
      const prevMarker = driverMarkersRef.current[driver.id];
      const prevLatLng = prevMarker ? prevMarker.latlng : null;

      let angle = 0;
      if (prevLatLng) {
        const pCoords = [prevLatLng.lat(), prevLatLng.lng()];
        if (pCoords[0] !== driver.coords[0] || pCoords[1] !== driver.coords[1]) {
          angle = getAngle(pCoords, driver.coords);
          prevMarker._lastAngle = angle;
        } else {
          angle = prevMarker._lastAngle || 0;
        }
      }

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

      const latlng = new window.google.maps.LatLng(driver.coords[0], driver.coords[1]);

      if (!prevMarker) {
        const marker = new HTMLMarker(latlng, carHtml, map);
        marker._lastAngle = angle;
        driverMarkersRef.current[driver.id] = marker;
      } else {
        prevMarker.setPosition(latlng);
        prevMarker.setHtml(carHtml);
      }
    });

    Object.keys(driverMarkersRef.current).forEach(id => {
      if (!currentDriverIds[id]) {
        driverMarkersRef.current[id].setMap(null);
        delete driverMarkersRef.current[id];
      }
    });
  }, [drivers, mapsLoaded]);

  // 6. Custom Pins for Pickup/Dropoff Selection
  useEffect(() => {
    const map = mapRef.current;
    const HTMLMarker = HTMLMarkerClassRef.current;
    if (!map || !HTMLMarker) return;

    // Pickup Pin (Green)
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
      const latlng = new window.google.maps.LatLng(customPickupCoords[0], customPickupCoords[1]);

      if (!customPickupMarkerRef.current) {
        customPickupMarkerRef.current = new HTMLMarker(latlng, pickupPinHtml, map);
      } else {
        customPickupMarkerRef.current.setPosition(latlng);
        customPickupMarkerRef.current.setHtml(pickupPinHtml);
      }
    } else {
      if (customPickupMarkerRef.current) {
        customPickupMarkerRef.current.setMap(null);
        customPickupMarkerRef.current = null;
      }
    }

    // Dropoff Pin (Pink)
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
      const latlng = new window.google.maps.LatLng(customDropoffCoords[0], customDropoffCoords[1]);

      if (!customDropoffMarkerRef.current) {
        customDropoffMarkerRef.current = new HTMLMarker(latlng, dropoffPinHtml, map);
      } else {
        customDropoffMarkerRef.current.setPosition(latlng);
        customDropoffMarkerRef.current.setHtml(dropoffPinHtml);
      }
    } else {
      if (customDropoffMarkerRef.current) {
        customDropoffMarkerRef.current.setMap(null);
        customDropoffMarkerRef.current = null;
      }
    }
  }, [customPickupCoords, customDropoffCoords, mapsLoaded]);

  // 7. Route Polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentRideIds = {};

    rides.forEach(ride => {
      if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED' || !ride.driverId) {
        if (activePolylinesRef.current[ride.id]) {
          activePolylinesRef.current[ride.id].setMap(null);
          delete activePolylinesRef.current[ride.id];
        }
        return;
      }

      currentRideIds[ride.id] = true;
      const remainingPoints = ride.routePoints.slice(ride.currentRouteIndex);
      const googlePoints = remainingPoints.map(pt => ({ lat: pt[0], lng: pt[1] }));

      const strokeColor = ride.status === 'ACCEPTED' ? '#ff9f43' : '#00f2fe';

      if (remainingPoints.length > 0) {
        if (!activePolylinesRef.current[ride.id]) {
          const polyline = new window.google.maps.Polyline({
            path: googlePoints,
            strokeColor: strokeColor,
            strokeWeight: 4,
            strokeOpacity: 0.8,
            map: map
          });
          activePolylinesRef.current[ride.id] = polyline;
        } else {
          activePolylinesRef.current[ride.id].setPath(googlePoints);
          activePolylinesRef.current[ride.id].setOptions({ strokeColor: strokeColor });
        }
      }
    });

    Object.keys(activePolylinesRef.current).forEach(id => {
      if (!currentRideIds[id]) {
        activePolylinesRef.current[id].setMap(null);
        delete activePolylinesRef.current[id];
      }
    });
  }, [rides, mapsLoaded]);

  // 8. Auto-Fit Bounds Camera Logic
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitRideId || !window.google) return;

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
        try {
          const bounds = new window.google.maps.LatLngBounds();
          coords.forEach(pt => bounds.extend({ lat: pt[0], lng: pt[1] }));
          mapRef.current.fitBounds(bounds);
        } catch (e) {
          console.error("Fit bounds error:", e);
        }
      }, 100);
    }
  }, [fitRideId, rides, drivers, mapsLoaded]);

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
      mapRef.current.panTo({ lat: result.coords[0], lng: result.coords[1] });
      mapRef.current.setZoom(14);
    }
    
    if (onMapClick) {
      onMapClick(result.coords, result.name);
    }
  };

  // Trigger map resize if container widths shift
  useEffect(() => {
    if (mapRef.current && window.google) {
      window.google.maps.event.trigger(mapRef.current, 'resize');
    }
  }, [height, width]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center bg-[#0d0e15] border border-white/5 rounded-xl text-[10px] text-danger p-4" style={{ height, width }}>
        Error loading Google Maps. Check connection or VITE_GOOGLE_MAPS_API_KEY.
      </div>
    );
  }

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
      {!mapsLoaded && (
        <div className="absolute inset-0 bg-[#0d0e15]/90 flex items-center justify-center text-[10px] text-text-muted">
          Loading Google Maps Engine...
        </div>
      )}
      
      <div 
        ref={mapContainerRef} 
        style={{ width: '100%', height: '100%', backgroundColor: '#0d0e15' }}
      />
      
      {/* Floating Map Search Overlay */}
      {mapsLoaded && onMapClick && (
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
