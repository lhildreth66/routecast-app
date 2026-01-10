import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';

const { width } = Dimensions.get('window');

type RouteMapProps = {
  routeGeometry: string; // Mapbox polyline
  waypoints: Array<{
    lat: number;
    lng: number;
    weather?: {
      condition?: string;
      alerts?: any[];
    };
  }>;
  origin: string;
  destination: string;
};

export function RouteMap({ routeGeometry, waypoints, origin, destination }: RouteMapProps) {
  const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
  
  // Find waypoints with bad weather
  const badWeatherPoints = useMemo(() => {
    return waypoints.filter(wp => {
      const hasAlerts = wp.weather?.alerts && wp.weather.alerts.length > 0;
      const badConditions = ['thunderstorm', 'snow', 'ice', 'fog', 'tornado', 'hurricane'];
      const hasBadCondition = badConditions.some(cond =>
        wp.weather?.condition?.toLowerCase().includes(cond)
      );
      return hasAlerts || hasBadCondition;
    });
  }, [waypoints]);

  // Calculate bounds
  const bounds = useMemo(() => {
    if (waypoints.length === 0) return null;

    const lats = waypoints.map(wp => wp.lat);
    const lons = waypoints.map(wp => wp.lon);

    return {
      minLon: Math.min(...lons),
      minLat: Math.min(...lats),
      maxLon: Math.max(...lons),
      maxLat: Math.max(...lats),
    };
  }, [waypoints]);

  const center = bounds ? {
    lon: (bounds.minLon + bounds.maxLon) / 2,
    lat: (bounds.minLat + bounds.maxLat) / 2,
  } : { lon: -95, lat: 40 };

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src='https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js'></script>
  <link href='https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css' rel='stylesheet' />
  <style>
    body { margin: 0; padding: 0; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id='map'></div>
  <script>
    mapboxgl.accessToken = '${MAPBOX_TOKEN}';
    
    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [${center.lon}, ${center.lat}],
      zoom: 6
    });

    map.on('load', () => {
      // Add route line
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: ${JSON.stringify(waypoints.map(wp => [wp.lon, wp.lat]))}
          }
        }
      });

      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#4a9eff',
          'line-width': 4
        }
      });

      // Add start marker (green)
      const startEl = document.createElement('div');
      startEl.style.width = '24px';
      startEl.style.height = '24px';
      startEl.style.borderRadius = '50%';
      startEl.style.backgroundColor = '#10b981';
      startEl.style.border = '3px solid white';
      startEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
      
      new mapboxgl.Marker({ element: startEl })
        .setLngLat([${waypoints[0]?.lon || 0}, ${waypoints[0]?.lat || 0}])
        .setPopup(new mapboxgl.Popup().setHTML('<strong>${origin}</strong>'))
        .addTo(map);

      // Add end marker (red)
      const endEl = document.createElement('div');
      endEl.style.width = '24px';
      endEl.style.height = '24px';
      endEl.style.borderRadius = '50%';
      endEl.style.backgroundColor = '#ef4444';
      endEl.style.border = '3px solid white';
      endEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
      
      const lastWp = ${waypoints.length - 1};
      new mapboxgl.Marker({ element: endEl })
        .setLngLat([${waypoints[waypoints.length - 1]?.lon || 0}, ${waypoints[waypoints.length - 1]?.lat || 0}])
        .setPopup(new mapboxgl.Popup().setHTML('<strong>${destination}</strong>'))
        .addTo(map);

      // Add weather warning markers (triangles)
      const badWeather = ${JSON.stringify(badWeatherPoints)};
      badWeather.forEach((point, idx) => {
        const el = document.createElement('div');
        el.innerHTML = '⚠️';
        el.style.fontSize = '24px';
        el.style.cursor = 'pointer';
        el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))';
        
        const popup = new mapboxgl.Popup({ offset: 15 })
          .setHTML('<div style="color: #000;"><strong>Weather Alert</strong><br/>' + 
                   (point.weather?.condition || 'Adverse conditions') + '</div>');
        
        new mapboxgl.Marker({ element: el })
          .setLngLat([point.lon, point.lat])
          .setPopup(popup)
          .addTo(map);
      });

      // Fit bounds
      if (${waypoints.length} > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        ${JSON.stringify(waypoints)}.forEach(wp => {
          bounds.extend([wp.lon, wp.lat]);
        });
        map.fitBounds(bounds, { padding: 50 });
      }
    });
  </script>
</body>
</html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: htmlContent }}
        style={styles.map}
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: width - 28,
    height: 300,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
  },
  map: {
    flex: 1,
  },
});
