import type { WindhoekLocation } from '../types/supabase';

// Places and ride types shared by the demo simulation and the production apps

export const WINDHOEK_LOCATIONS: WindhoekLocation[] = [
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
