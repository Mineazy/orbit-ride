import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

// MapLibre, pmtiles and the basemap styles are large, so load them on demand
// instead of in the main bundle.
const MapView = lazy(() => import('./MapView'));

type MapViewProps = ComponentProps<typeof MapView>;

export default function LazyMapView(props: MapViewProps) {
  const { height = '100%', width = '100%' } = props;
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center bg-bg-surface-solid border border-muted rounded-xl text-[10px] text-text-muted"
          style={{ height, width }}
        >
          Loading map...
        </div>
      }
    >
      <MapView {...props} />
    </Suspense>
  );
}
