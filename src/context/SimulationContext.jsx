import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';

const SimulationContext = createContext(undefined);

// Windhoek Locations Mock Data
export const WINDHOEK_LOCATIONS = [
  { id: 'loc-cbd', name: 'Windhoek CBD (Independence Ave)', coords: [-22.5615, 17.0835], type: 'business' },
  { id: 'loc-maerua', name: 'Maerua Mall', coords: [-22.5786, 17.0903], type: 'shopping' },
  { id: 'loc-grove', name: 'The Grove Mall', coords: [-22.6175, 17.0986], type: 'shopping' },
  { id: 'loc-unam', name: 'University of Namibia (UNAM)', coords: [-22.6115, 17.0585], type: 'leisure' },
  { id: 'loc-katutura', name: 'Katutura District', coords: [-22.5255, 17.0543], type: 'culture' },
  { id: 'loc-airport', name: 'Eros Airport (ERS)', coords: [-22.6120, 17.0795], type: 'airport' },
  { id: 'loc-museum', name: 'National Museum of Namibia', coords: [-22.5694, 17.0858], type: 'tourism' },
  { id: 'loc-olympia', name: 'Olympia Suburb', coords: [-22.5975, 17.0935], type: 'leisure' },
  { id: 'loc-khomasdal', name: 'Khomasdal Area', coords: [-22.5525, 17.0425], type: 'culture' },
];

export const VEHICLE_TIERS = {
  OrbitX: { name: 'OrbitX', label: 'Economy', base: 2.50, perKm: 0.75, multiplier: 1.0, speed: 1.0, car: 'Toyota Camry (Silver)' },
  OrbitXL: { name: 'OrbitXL', label: 'Spacious SUV', base: 5.00, perKm: 1.25, multiplier: 1.5, speed: 0.9, car: 'Tesla Model Y (White)' },
  OrbitFly: { name: 'OrbitFly', label: 'Premium Electric', base: 10.00, perKm: 2.15, multiplier: 2.2, speed: 1.2, car: 'Lucid Air (Nebula Blue)' },
};

// Helper: Calculate distance between coordinates in km (Haversine formula)
export const calculateDistance = (coords1, coords2) => {
  const [lat1, lon1] = coords1;
  const [lat2, lon2] = coords2;
  const R = 6371.0; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Helper: Interpolates a realistic route between start and end coordinate points
export const generateRoute = (start, end, stepsCount = 60) => {
  const points = [];
  const startLat = start[0];
  const startLng = start[1];
  const endLat = end[0];
  const endLng = end[1];

  const midLat1 = startLat + (endLat - startLat) * 0.3;
  const midLng1 = startLng;

  const midLat2 = midLat1;
  const midLng2 = startLng + (endLng - startLng) * 0.7;

  const anchors = [
    [startLat, startLng],
    [midLat1, midLng1],
    [midLat2, midLng2],
    [endLat, endLng]
  ];

  const segments = anchors.length - 1;
  const stepsPerSegment = Math.floor(stepsCount / segments);

  for (let i = 0; i < segments; i++) {
    const sPoint = anchors[i];
    const ePoint = anchors[i+1];
    const segmentSteps = (i === segments - 1) 
      ? stepsCount - (stepsPerSegment * i) 
      : stepsPerSegment;

    for (let j = 0; j < segmentSteps; j++) {
      const t = j / segmentSteps;
      const lat = sPoint[0] + (ePoint[0] - sPoint[0]) * t;
      const lng = sPoint[1] + (ePoint[1] - sPoint[1]) * t;
      points.push([lat, lng]);
    }
  }
  points.push([endLat, endLng]);
  return points;
};

export const SimulationProvider = ({ children }) => {
  // Global simulation states
  const [drivers, setDrivers] = useState(() => {
    const defaultDrivers = [
      {
        id: 'driver-1',
        name: 'Elena Rostova',
        car: 'Tesla Model Y (White)',
        rating: 4.92,
        status: 'OFFLINE',
        coords: [-22.5720, 17.0810],
        earnings: 124.50,
        tier: 'OrbitXL',
        activeRideId: null,
        avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      },
      {
        id: 'driver-2',
        name: 'Alex Mercer',
        car: 'Toyota Camry (Silver)',
        rating: 4.85,
        status: 'OFFLINE',
        coords: [-22.5900, 17.0750],
        earnings: 85.00,
        tier: 'OrbitX',
        activeRideId: null,
        avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
      },
      {
        id: 'driver-3',
        name: 'Sarah Chen',
        car: 'Lucid Air (Nebula Blue)',
        rating: 4.98,
        status: 'OFFLINE',
        coords: [-22.5500, 17.0650],
        earnings: 210.00,
        tier: 'OrbitFly',
        activeRideId: null,
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      },
    ];
    try {
      const stored = localStorage.getItem('orbitride_custom_drivers');
      let loadedDrivers = defaultDrivers;
      if (stored) {
        const custom = JSON.parse(stored);
        loadedDrivers = [...defaultDrivers, ...custom];
      }
      // Apply saved custom avatars if any
      const savedAvatars = localStorage.getItem('orbitride_driver_avatars');
      if (savedAvatars) {
        const mapping = JSON.parse(savedAvatars);
        loadedDrivers = loadedDrivers.map(d => mapping[d.id] ? { ...d, avatar: mapping[d.id] } : d);
      }
      return loadedDrivers;
    } catch (e) {
      console.error('Error loading custom drivers from localStorage:', e);
    }
    return defaultDrivers;
  });

  const [passenger, setPassenger] = useState({
    id: 'passenger-client',
    name: 'Hanzu (You)',
    coords: [-22.5615, 17.0835],
    activeRideId: null,
    rating: 4.95,
    balance: 500.00,
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  });

  const [rides, setRides] = useState([]);
  const [logs, setLogs] = useState([
    { id: 1, time: new Date().toLocaleTimeString(), text: 'Ride-sharing simulation initialized in Windhoek Network.', type: 'info' }
  ]);

  const [metrics, setMetrics] = useState({
    totalTrips: 32,
    totalRevenue: 542.80,
    avgRating: 4.91,
  });

  // Settings
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [surgeMultiplier, setSurgeMultiplier] = useState(1.0);
  const [weather, setWeather] = useState('clear');
  const [autoMode, setAutoMode] = useState(false);

  // 1. SUPABASE INITIAL FETCH AND REAL-TIME SUB
  useEffect(() => {
    if (!supabase) return;

    // Fetch initial database snapshots
    const loadSnapshots = async () => {
      // Drivers
      const { data: dbDrivers } = await supabase.from('drivers').select('*');
      if (dbDrivers && dbDrivers.length > 0) {
        setDrivers(dbDrivers.map(d => ({
          id: d.id, name: d.name, car: d.car, rating: d.rating, status: d.status,
          coords: d.coords, earnings: d.earnings, tier: d.tier, activeRideId: d.active_ride_id, avatar: d.avatar
        })));
      }

      // Passenger
      const { data: dbPassenger } = await supabase.from('passenger_client').select('*').eq('id', 'passenger-client').single();
      if (dbPassenger) {
        setPassenger(p => ({
          ...p, coords: dbPassenger.coords, activeRideId: dbPassenger.active_ride_id, balance: dbPassenger.balance
        }));
      }

      // Rides (active or recent)
      const { data: dbRides } = await supabase.from('rides').select('*').order('timestamp', { ascending: true });
      if (dbRides) {
        setRides(dbRides.map(r => ({
          id: r.id, passengerId: r.passenger_id, passengerName: r.passenger_name, passengerAvatar: r.passenger_avatar,
          driverId: r.driver_id, pickupName: r.pickup_name, dropoffName: r.dropoff_name, pickupCoords: r.pickup_coords,
          dropoffCoords: r.dropoff_coords, distance: r.distance, fare: r.fare, status: r.status, tier: r.tier,
          routePoints: r.route_points || [], currentRouteIndex: r.current_route_index, timestamp: r.timestamp
        })));
      }

      // Logs
      const { data: dbLogs } = await supabase.from('logs').select('*').order('created_at', { ascending: false }).limit(40);
      if (dbLogs) {
        setLogs(dbLogs.map(l => ({ id: l.id, time: l.time, text: l.text, type: l.type })));
      }

      // Metrics
      const { data: dbMetrics } = await supabase.from('metrics').select('*').eq('id', 'global_metrics').single();
      if (dbMetrics) {
        setMetrics({ totalTrips: dbMetrics.total_trips, totalRevenue: dbMetrics.total_revenue, avgRating: dbMetrics.avg_rating });
      }
    };

    loadSnapshots();

    // Setup real-time listeners for instant synchronization across browser clients
    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, (payload) => {
        if (!payload.new) return;
        setDrivers(prev => {
          const exists = prev.some(d => d.id === payload.new.id);
          if (!exists && payload.eventType === 'INSERT') {
            return [...prev, {
              id: payload.new.id,
              name: payload.new.name,
              car: payload.new.car,
              rating: payload.new.rating,
              status: payload.new.status,
              coords: payload.new.coords,
              earnings: payload.new.earnings,
              tier: payload.new.tier,
              activeRideId: payload.new.active_ride_id,
              avatar: payload.new.avatar
            }];
          }
          return prev.map(d => d.id === payload.new.id ? {
            ...d,
            name: payload.new.name || d.name,
            car: payload.new.car || d.car,
            status: payload.new.status,
            coords: payload.new.coords,
            earnings: payload.new.earnings,
            rating: payload.new.rating,
            activeRideId: payload.new.active_ride_id,
            avatar: payload.new.avatar || d.avatar
          } : d);
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'passenger_client' }, (payload) => {
        if (payload.new.id === 'passenger-client') {
          setPassenger(p => ({ ...p, activeRideId: payload.new.active_ride_id, balance: payload.new.balance }));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, (payload) => {
        const row = payload.new;
        if (payload.eventType === 'INSERT') {
          setRides(prev => [...prev.filter(r => r.id !== row.id), {
            id: row.id, passengerId: row.passenger_id, passengerName: row.passenger_name, passengerAvatar: row.passenger_avatar,
            driverId: row.driver_id, pickupName: row.pickup_name, dropoffName: row.dropoff_name, pickupCoords: row.pickup_coords,
            dropoffCoords: row.dropoff_coords, distance: row.distance, fare: row.fare, status: row.status, tier: row.tier,
            routePoints: row.route_points || [], currentRouteIndex: row.current_route_index, timestamp: row.timestamp
          }]);
        } else if (payload.eventType === 'UPDATE') {
          setRides(prev => prev.map(r => r.id === row.id ? {
            ...r, driverId: row.driver_id, status: row.status, currentRouteIndex: row.current_route_index, routePoints: row.route_points || []
          } : r));
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' }, (payload) => {
        setLogs(prev => [{ id: payload.new.id, time: payload.new.time, text: payload.new.text, type: payload.new.type }, ...prev].slice(0, 100));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'metrics' }, (payload) => {
        if (payload.new.id === 'global_metrics') {
          setMetrics({ totalTrips: payload.new.total_trips, totalRevenue: payload.new.total_revenue, avgRating: payload.new.avg_rating });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const addLog = async (text, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    const id = Date.now() + Math.random();
    
    if (supabase) {
      await supabase.from('logs').insert([{ id, time, text, type }]);
    } else {
      setLogs(prev => [{ id, time, text, type }, ...prev].slice(0, 100));
    }
  };

  // Passenger requests a ride with custom fare offer capability
  const requestRide = async (pickupCoords, dropoffCoords, pickupName, dropoffName, tier, customFare = null) => {
    const rideId = `ride-${Date.now()}`;
    const distance = calculateDistance(pickupCoords, dropoffCoords);
    const config = VEHICLE_TIERS[tier];
    
    const basePrice = config.base;
    const kmPrice = config.perKm * distance;
    const weatherFactor = weather === 'rainy' ? 1.3 : 1.0;
    const calculatedFare = parseFloat(((basePrice + kmPrice) * surgeMultiplier * weatherFactor).toFixed(2));
    const finalFare = customFare !== null ? parseFloat(customFare) : calculatedFare;
    
    const newRide = {
      id: rideId,
      passengerId: passenger.id,
      passengerName: passenger.name,
      passengerAvatar: passenger.avatar,
      driverId: null,
      pickupName,
      dropoffName,
      pickupCoords,
      dropoffCoords,
      distance: parseFloat(distance.toFixed(2)),
      fare: finalFare,
      status: 'REQUESTED',
      tier,
      routePoints: [],
      currentRouteIndex: 0,
      timestamp: Date.now()
    };

    if (supabase) {
      await supabase.from('rides').insert([{
        id: rideId, passenger_id: passenger.id, passenger_name: passenger.name, passenger_avatar: passenger.avatar,
        driver_id: null, pickup_name: pickupName, dropoff_name: dropoffName, pickup_coords: pickupCoords,
        dropoff_coords: dropoffCoords, distance: newRide.distance, fare: finalFare, status: 'REQUESTED', tier,
        route_points: [], current_route_index: 0, timestamp: newRide.timestamp
      }]);
      await supabase.from('passenger_client').update({ active_ride_id: rideId }).eq('id', passenger.id);
    } else {
      setRides(prev => [...prev, newRide]);
      setPassenger(prev => ({ ...prev, activeRideId: rideId }));
    }
    
    addLog(`Passenger requested a ${tier} from ${pickupName} to ${dropoffName} (Offer: N$${finalFare})`, 'passenger');
    return rideId;
  };

  // Driver accepts a ride
  const acceptRide = async (driverId, rideId) => {
    const driverObj = drivers.find(d => d.id === driverId);
    const targetRide = rides.find(r => r.id === rideId);
    if (!driverObj || !targetRide) return;

    const routePoints = generateRoute(driverObj.coords, targetRide.pickupCoords, 40);

    if (supabase) {
      await supabase.from('rides').update({
        driver_id: driverId,
        status: 'ACCEPTED',
        route_points: routePoints,
        current_route_index: 0
      }).eq('id', rideId);

      await supabase.from('drivers').update({
        status: 'EN_ROUTE_PICKUP',
        active_ride_id: rideId
      }).eq('id', driverId);
    } else {
      setRides(prev => prev.map(ride => {
        if (ride.id === rideId) {
          return { ...ride, driverId, status: 'ACCEPTED', routePoints, currentRouteIndex: 0 };
        }
        return ride;
      }));

      setDrivers(prev => prev.map(d => {
        if (d.id === driverId) {
          return { ...d, status: 'EN_ROUTE_PICKUP', activeRideId: rideId };
        }
        return d;
      }));
    }

    addLog(`Driver ${driverObj.name} accepted ride request. En route to pickup.`, 'driver');
  };

  // Driver arrives at pickup
  const markArrived = async (rideId) => {
    const targetRide = rides.find(r => r.id === rideId);
    if (!targetRide) return;

    if (supabase) {
      await supabase.from('rides').update({ status: 'ARRIVED' }).eq('id', rideId);
    } else {
      setRides(prev => prev.map(ride => ride.id === rideId ? { ...ride, status: 'ARRIVED' } : ride));
    }

    const driverObj = drivers.find(d => d.id === targetRide.driverId);
    addLog(`Driver ${driverObj?.name || 'Partner'} has arrived at pickup point.`, 'driver');
  };

  // Driver starts the trip
  const startTrip = async (rideId) => {
    const targetRide = rides.find(r => r.id === rideId);
    if (!targetRide) return;

    const routePoints = generateRoute(targetRide.pickupCoords, targetRide.dropoffCoords, 60);

    if (supabase) {
      await supabase.from('rides').update({
        status: 'IN_PROGRESS',
        route_points: routePoints,
        current_route_index: 0
      }).eq('id', rideId);

      await supabase.from('drivers').update({ status: 'EN_ROUTE_DROPOFF' }).eq('id', targetRide.driverId);
    } else {
      setRides(prev => prev.map(ride => ride.id === rideId ? {
        ...ride, status: 'IN_PROGRESS', routePoints, currentRouteIndex: 0
      } : ride));

      setDrivers(prev => prev.map(d => d.id === targetRide.driverId ? { ...d, status: 'EN_ROUTE_DROPOFF' } : d));
    }

    addLog(`Trip started. Heading to dropoff: ${targetRide.dropoffName}.`, 'driver');
  };

  // Driver completes the trip
  const completeTrip = async (rideId, rating = 5) => {
    const targetRide = rides.find(r => r.id === rideId);
    if (!targetRide) return;

    const earned = parseFloat((targetRide.fare * 0.8).toFixed(2));
    const customerPaid = targetRide.fare;
    const driverObj = drivers.find(d => d.id === targetRide.driverId);

    if (supabase) {
      // 1. Mark ride completed
      await supabase.from('rides').update({ status: 'COMPLETED' }).eq('id', rideId);
      
      // 2. Charge passenger balance
      await supabase.from('passenger_client').update({
        active_ride_id: null,
        balance: parseFloat((passenger.balance - customerPaid).toFixed(2))
      }).eq('id', passenger.id);

      // 3. Payout driver & adjust rating
      if (driverObj) {
        const newRating = parseFloat(((driverObj.rating * 19 + rating) / 20).toFixed(2));
        await supabase.from('drivers').update({
          status: 'ONLINE_IDLE',
          earnings: parseFloat((driverObj.earnings + earned).toFixed(2)),
          rating: newRating,
          active_ride_id: null
        }).eq('id', driverObj.id);
      }

      // 4. Update metrics
      await supabase.from('metrics').update({
        total_trips: metrics.totalTrips + 1,
        total_revenue: parseFloat((metrics.totalRevenue + customerPaid).toFixed(2)),
        avg_rating: parseFloat(((metrics.avgRating * 99 + rating) / 100).toFixed(2))
      }).eq('id', 'global_metrics');

    } else {
      setRides(prev => prev.map(ride => ride.id === rideId ? { ...ride, status: 'COMPLETED' } : ride));

      if (driverObj) {
        setDrivers(prev => prev.map(d => {
          if (d.id === driverObj.id) {
            const newRating = parseFloat(((d.rating * 19 + rating) / 20).toFixed(2));
            return {
              ...d, status: 'ONLINE_IDLE', earnings: parseFloat((d.earnings + earned).toFixed(2)), rating: newRating, activeRideId: null
            };
          }
          return d;
        }));
      }

      setPassenger(prev => ({
        ...prev, activeRideId: null, balance: parseFloat((prev.balance - customerPaid).toFixed(2))
      }));

      setMetrics(prev => ({
        ...prev,
        totalTrips: prev.totalTrips + 1,
        totalRevenue: parseFloat((prev.totalRevenue + customerPaid).toFixed(2)),
        avgRating: parseFloat(((prev.avgRating * 99 + rating) / 100).toFixed(2))
      }));
    }

    addLog(`Trip completed. Passenger paid N$${customerPaid}. Driver ${driverObj?.name} earned N$${earned}.`, 'success');
  };

  // Cancel ride
  const cancelRide = async (rideId) => {
    const targetRide = rides.find(r => r.id === rideId);
    if (!targetRide) return;

    if (supabase) {
      await supabase.from('rides').update({ status: 'CANCELLED' }).eq('id', rideId);
      await supabase.from('passenger_client').update({ active_ride_id: null }).eq('id', passenger.id);
      if (targetRide.driverId) {
        await supabase.from('drivers').update({ status: 'ONLINE_IDLE', active_ride_id: null }).eq('id', targetRide.driverId);
      }
    } else {
      setRides(prev => prev.map(ride => ride.id === rideId ? { ...ride, status: 'CANCELLED' } : ride));
      setPassenger(prev => ({ ...prev, activeRideId: null }));
      if (targetRide.driverId) {
        setDrivers(prev => prev.map(d => d.id === targetRide.driverId ? { ...d, status: 'ONLINE_IDLE', activeRideId: null } : d));
      }
    }

    addLog(`Ride ${rideId.substring(0, 8)} was cancelled.`, 'warning');
  };

  // Toggle Driver Online Status
  const toggleDriverOnline = async (driverId) => {
    const driverObj = drivers.find(d => d.id === driverId);
    if (!driverObj) return;

    const nextStatus = driverObj.status === 'OFFLINE' ? 'ONLINE_IDLE' : 'OFFLINE';

    if (supabase) {
      await supabase.from('drivers').update({ status: nextStatus }).eq('id', driverId);
    } else {
      setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, status: nextStatus } : d));
    }

    addLog(`Driver ${driverObj.name} is now ${nextStatus === 'OFFLINE' ? 'OFFLINE' : 'ONLINE'}.`, 'system');
  };

  // Register a new driver profile
  const registerDriver = async (name, car, tier, avatarUrl = null) => {
    const driverId = `driver-${Date.now()}`;
    // Seed location around Windhoek CBD coords [-22.5615, 17.0835] with slight offset
    const latOffset = (Math.random() - 0.5) * 0.015;
    const lonOffset = (Math.random() - 0.5) * 0.015;
    const coords = [-22.5615 + latOffset, 17.0835 + lonOffset];
    
    const defaultAvatar = avatarUrl || `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 500000)}?w=150&auto=format&fit=crop&q=80`;

    const newDriver = {
      id: driverId,
      name,
      car,
      rating: 5.0,
      status: 'OFFLINE',
      coords,
      earnings: 0.0,
      tier,
      activeRideId: null,
      avatar: defaultAvatar
    };

    if (supabase) {
      await supabase.from('drivers').insert([{
        id: driverId,
        name,
        car,
        rating: 5.0,
        status: 'OFFLINE',
        coords,
        earnings: 0.0,
        tier,
        active_ride_id: null,
        avatar: defaultAvatar
      }]);
      // Local state is synced via Realtime, but for offline fallback/immediate feedback:
      setDrivers(prev => [...prev, newDriver]);
    } else {
      setDrivers(prev => [...prev, newDriver]);
    }

    // Persist custom driver to localStorage for offline usage
    try {
      const stored = localStorage.getItem('orbitride_custom_drivers');
      const custom = stored ? JSON.parse(stored) : [];
      custom.push(newDriver);
      localStorage.setItem('orbitride_custom_drivers', JSON.stringify(custom));
    } catch (e) {
      console.error('Error saving custom driver to localStorage:', e);
    }

    addLog(`New driver registered: ${name} (${tier}) driving a ${car}.`, 'system');
    return driverId;
  };

  // Update an existing driver's avatar
  const updateDriverAvatar = async (driverId, avatarUrl) => {
    if (supabase) {
      await supabase.from('drivers').update({ avatar: avatarUrl }).eq('id', driverId);
    }
    
    setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, avatar: avatarUrl } : d));
    
    // Save to LocalStorage mapping for persistent offline simulation
    try {
      const savedAvatars = localStorage.getItem('orbitride_driver_avatars');
      const mapping = savedAvatars ? JSON.parse(savedAvatars) : {};
      mapping[driverId] = avatarUrl;
      localStorage.setItem('orbitride_driver_avatars', JSON.stringify(mapping));
    } catch (e) {
      console.error('Error saving custom avatar to localStorage:', e);
    }
    
    // If it is a custom registered driver, update their record in orbitride_custom_drivers
    try {
      const stored = localStorage.getItem('orbitride_custom_drivers');
      if (stored) {
        const custom = JSON.parse(stored);
        const updated = custom.map(d => d.id === driverId ? { ...d, avatar: avatarUrl } : d);
        localStorage.setItem('orbitride_custom_drivers', JSON.stringify(updated));
      }
    } catch (e) {
      console.error('Error updating custom driver in localStorage:', e);
    }

    addLog(`Driver avatar updated.`, 'system');
  };

  // Top up passenger wallet balance
  const topUpPassengerBalance = async (amount) => {
    const nextBalance = parseFloat((passenger.balance + amount).toFixed(2));
    if (supabase) {
      await supabase.from('passenger_client').update({ balance: nextBalance }).eq('id', passenger.id);
    }
    
    setPassenger(prev => ({ ...prev, balance: nextBalance }));
    addLog(`Passenger topped up N$${amount.toFixed(2)} to wallet.`, 'passenger');
  };

  // Background Loop: Simulated Autodispatch bots (Spawns bookings)
  useEffect(() => {
    if (!autoMode) return;

    const interval = setInterval(async () => {
      const idleDrivers = drivers.filter(d => d.status === 'ONLINE_IDLE');
      if (idleDrivers.length === 0) return;

      const randomDriver = idleDrivers[Math.floor(Math.random() * idleDrivers.length)];
      
      const pickupLoc = WINDHOEK_LOCATIONS[Math.floor(Math.random() * WINDHOEK_LOCATIONS.length)];
      let dropoffLoc = WINDHOEK_LOCATIONS[Math.floor(Math.random() * WINDHOEK_LOCATIONS.length)];
      while (dropoffLoc.id === pickupLoc.id) {
        dropoffLoc = WINDHOEK_LOCATIONS[Math.floor(Math.random() * WINDHOEK_LOCATIONS.length)];
      }

      const names = ['Liam', 'Sophia', 'Jackson', 'Olivia', 'Lucas', 'Mia', 'Aria', 'Ethan', 'Bella'];
      const passName = names[Math.floor(Math.random() * names.length)];
      
      const botRideId = `bot-ride-${Date.now()}`;
      const distance = calculateDistance(pickupLoc.coords, dropoffLoc.coords);
      const tierOptions = ['OrbitX', 'OrbitXL', 'OrbitFly'];
      const botTier = tierOptions[Math.floor(Math.random() * tierOptions.length)];
      const config = VEHICLE_TIERS[botTier];
      const finalFare = parseFloat(((config.base + config.perKm * distance) * surgeMultiplier * (weather === 'rainy' ? 1.3 : 1)).toFixed(2));

      const routePoints = generateRoute(randomDriver.coords, pickupLoc.coords, 40);

      if (supabase) {
        await supabase.from('rides').insert([{
          id: botRideId, passenger_id: `bot-p-${Date.now()}`, passenger_name: `${passName} (Bot)`,
          driver_id: randomDriver.id, pickup_name: pickupLoc.name, dropoff_name: dropoffLoc.name,
          pickup_coords: pickupLoc.coords, dropoff_coords: dropoffLoc.coords, distance: parseFloat(distance.toFixed(2)),
          fare: finalFare, status: 'ACCEPTED', tier: botTier, route_points: routePoints, current_route_index: 0, timestamp: Date.now()
        }]);

        await supabase.from('drivers').update({
          status: 'EN_ROUTE_PICKUP', active_ride_id: botRideId
        }).eq('id', randomDriver.id);
      } else {
        const newBotRide = {
          id: botRideId, passengerId: `bot-p-${Date.now()}`, passengerName: `${passName} (Bot)`,
          passengerAvatar: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 500000)}?w=150&auto=format&fit=crop&q=80`,
          driverId: randomDriver.id, pickupName: pickupLoc.name, dropoffName: dropoffLoc.name,
          pickupCoords: pickupLoc.coords, dropoffCoords: dropoffLoc.coords, distance: parseFloat(distance.toFixed(2)),
          fare: finalFare, status: 'ACCEPTED', tier: botTier, routePoints, currentRouteIndex: 0, timestamp: Date.now()
        };

        setRides(prev => [...prev, newBotRide]);
        setDrivers(prev => prev.map(d => d.id === randomDriver.id ? { ...d, status: 'EN_ROUTE_PICKUP', activeRideId: botRideId } : d));
      }

      addLog(`[AutoDispatch] Assigned simulated ride #${botRideId.substring(9, 13)} to ${randomDriver.name} (${passName} requested ${botTier})`, 'system');

    }, 12000 / simulationSpeed);

    return () => clearInterval(interval);
  }, [autoMode, drivers, simulationSpeed, surgeMultiplier, weather]);

  // Main Simulation tick loop: Interpolates vehicle coordinates along routes
  useEffect(() => {
    const tickInterval = setInterval(async () => {
      // Loop over rides in local state (which syncs from database)
      for (const ride of rides) {
        if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED') continue;
        
        // Find driver
        const driverObj = drivers.find(d => d.id === ride.driverId);
        if (!driverObj) continue;

        // Drive to pickup
        if (ride.status === 'ACCEPTED') {
          const nextIdx = ride.currentRouteIndex + (1 * simulationSpeed);
          if (nextIdx >= ride.routePoints.length) {
            // Arrived at pickup
            if (ride.passengerId.startsWith('bot-p-')) {
              // Bot starts trip automatically
              if (supabase) {
                const routePoints = generateRoute(ride.pickupCoords, ride.dropoffCoords, 60);
                await supabase.from('rides').update({ status: 'IN_PROGRESS', route_points: routePoints, current_route_index: 0 }).eq('id', ride.id);
                await supabase.from('drivers').update({ status: 'EN_ROUTE_DROPOFF' }).eq('id', ride.driverId);
              } else {
                startTrip(ride.id);
              }
            } else {
              // Real client triggers Arrived
              if (supabase) {
                await supabase.from('rides').update({ status: 'ARRIVED' }).eq('id', ride.id);
              } else {
                markArrived(ride.id);
              }
            }
          } else {
            // Move driver coords
            const nextCoords = ride.routePoints[nextIdx];
            if (supabase) {
              await supabase.from('drivers').update({ coords: nextCoords }).eq('id', ride.driverId);
              await supabase.from('rides').update({ current_route_index: nextIdx }).eq('id', ride.id);
            } else {
              setDrivers(prev => prev.map(d => d.id === ride.driverId ? { ...d, coords: nextCoords } : d));
              setRides(prev => prev.map(r => r.id === ride.id ? { ...r, currentRouteIndex: nextIdx } : r));
            }
          }
        }

        // Drive to destination
        if (ride.status === 'IN_PROGRESS') {
          const nextIdx = ride.currentRouteIndex + (1 * simulationSpeed);
          if (nextIdx >= ride.routePoints.length) {
            // Arrived at dropoff
            if (ride.passengerId.startsWith('bot-p-')) {
              // Bot completes trip automatically
              if (supabase) {
                await supabase.from('rides').update({ status: 'COMPLETED' }).eq('id', ride.id);
                const earned = parseFloat((ride.fare * 0.8).toFixed(2));
                const customerPaid = ride.fare;
                const newRating = parseFloat(((driverObj.rating * 19 + 5) / 20).toFixed(2));
                await supabase.from('drivers').update({ status: 'ONLINE_IDLE', earnings: parseFloat((driverObj.earnings + earned).toFixed(2)), rating: newRating, active_ride_id: null }).eq('id', driverObj.id);
                await supabase.from('metrics').update({ total_trips: metrics.totalTrips + 1, total_revenue: parseFloat((metrics.totalRevenue + customerPaid).toFixed(2)) }).eq('id', 'global_metrics');
              } else {
                completeTrip(ride.id, 5);
              }
            } else {
              // Real customer wait for completeTrip call
            }
          } else {
            const nextCoords = ride.routePoints[nextIdx];
            if (supabase) {
              await supabase.from('drivers').update({ coords: nextCoords }).eq('id', ride.driverId);
              await supabase.from('rides').update({ current_route_index: nextIdx }).eq('id', ride.id);
            } else {
              setDrivers(prev => prev.map(d => d.id === ride.driverId ? { ...d, coords: nextCoords } : d));
              setRides(prev => prev.map(r => r.id === ride.id ? { ...r, currentRouteIndex: nextIdx } : r));
            }
          }
        }
      }
    }, 1000);

    return () => clearInterval(tickInterval);
  }, [rides, drivers, simulationSpeed, metrics]);

  return (
    <SimulationContext.Provider
      value={{
        drivers,
        passenger,
        rides,
        logs,
        metrics,
        simulationSpeed,
        setSimulationSpeed,
        surgeMultiplier,
        setSurgeMultiplier,
        weather,
        setWeather,
        autoMode,
        setAutoMode,
        requestRide,
        acceptRide,
        markArrived,
        startTrip,
        completeTrip,
        cancelRide,
        toggleDriverOnline,
        registerDriver,
        updateDriverAvatar,
        topUpPassengerBalance,
        addLog
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
};

export const useSimulation = () => {
  const context = useContext(SimulationContext);
  if (context === undefined) {
    throw new Error('useSimulation must be used within a SimulationProvider');
  }
  return context;
};
