import React, { createContext, useContext } from 'react';

export type MapEngine = 'google' | 'osm';

const MapEngineContext = createContext<MapEngine>('google');

export const MapEngineProvider: React.FC<{
  engine: MapEngine;
  children: React.ReactNode;
}> = ({ engine, children }) => (
  <MapEngineContext.Provider value={engine}>
    {children}
  </MapEngineContext.Provider>
);

export function useMapEngine(): MapEngine {
  return useContext(MapEngineContext);
}
