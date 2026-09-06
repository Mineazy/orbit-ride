export interface Driver {
  id: string;
  name: string;
  car: string;
  rating: number;
  status: 'OFFLINE' | 'ONLINE_IDLE' | 'EN_ROUTE_PICKUP' | 'EN_ROUTE_DROPOFF';
  coords: [number, number];
  earnings: number;
  tier: 'OrbitX' | 'OrbitXL' | 'OrbitFly';
  activeRideId: string | null;
  avatar: string;
  profileId?: string;
  updatedAt: string;
}

export interface PassengerClient {
  id: string;
  name: string;
  coords: [number, number];
  activeRideId: string | null;
  rating: number;
  balance: number;
  avatar: string;
  profileId?: string;
  updatedAt: string;
}

export interface Ride {
  id: string;
  passengerId: string;
  passengerName: string;
  passengerAvatar: string | null;
  driverId: string | null;
  pickupName: string;
  dropoffName: string;
  pickupCoords: [number, number];
  dropoffCoords: [number, number];
  distance: number;
  fare: number;
  status: 'REQUESTED' | 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  tier: 'OrbitX' | 'OrbitXL' | 'OrbitFly';
  routePoints: [number, number][][] | [];
  currentRouteIndex: number;
  timestamp: number;
  updatedAt: string;
}

export interface LogEntry {
  id: number;
  time: string;
  text: string;
  type: 'info' | 'success' | 'warning' | 'driver' | 'passenger' | 'system';
  createdAt: string;
}

export interface Metrics {
  id: string;
  totalTrips: number;
  totalRevenue: number;
  avgRating: number;
}

export interface Profile {
  id: string;
  fullName: string | null;
  role: 'passenger' | 'driver' | 'admin';
  avatar: string | null;
  createdAt: string;
}

export interface VehicleTierConfig {
  name: string;
  label: string;
  base: number;
  perKm: number;
  multiplier: number;
  speed: number;
  car: string;
}

export interface WindhoekLocation {
  id: string;
  name: string;
  coords: [number, number];
  type: 'business' | 'shopping' | 'leisure' | 'culture' | 'airport' | 'tourism';
}

export interface SimulationState {
  drivers: Driver[];
  passenger: PassengerClient;
  rides: Ride[];
  logs: LogEntry[];
  metrics: Metrics;
  simulationSpeed: number;
  surgeMultiplier: number;
  weather: 'clear' | 'rainy';
  autoMode: boolean;
}
