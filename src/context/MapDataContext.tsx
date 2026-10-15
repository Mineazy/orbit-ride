import { createContext, useContext } from 'react';

// What the map needs to draw: vehicles, the passenger marker and ride routes.
// The demo simulation provides this from its state; the production apps provide their own (or nothing).
export interface MapData {
  drivers: any[];
  passenger: any | null;
  rides: any[];
}

const EMPTY: MapData = { drivers: [], passenger: null, rides: [] };

export const MapDataContext = createContext<MapData>(EMPTY);

export const useMapData = (): MapData => useContext(MapDataContext);
