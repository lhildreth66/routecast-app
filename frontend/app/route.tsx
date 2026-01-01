import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Notifications from 'expo-notifications';

// Conditionally import MapView for native platforms
let MapView: any = null;
let Polyline: any = null;
let Marker: any = null;

if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Polyline = Maps.Polyline;
  Marker = Maps.Marker;
}

const { width } = Dimensions.get('window');

interface WeatherData {
  temperature: number | null;
  temperature_unit: string;
  wind_speed: string | null;
  wind_direction: string | null;
  conditions: string | null;
  icon: string | null;
  humidity: number | null;
  is_daytime: boolean;
}

interface WeatherAlert {
  id: string;
  headline: string;
  severity: string;
  event: string;
  description: string;
  areas: string | null;
}

interface Waypoint {
  lat: number;
  lon: number;
  name: string | null;
  distance_from_start: number | null;
}

interface WaypointWeather {
  waypoint: Waypoint;
  weather: WeatherData | null;
  alerts: WeatherAlert[];
  error: string | null;
}

interface RouteData {
  id: string;
  origin: string;
  destination: string;
  route_geometry: string;
  waypoints: WaypointWeather[];
  ai_summary: string | null;
  has_severe_weather: boolean;
  created_at: string;
}

// Decode polyline utility
function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
}

function getWeatherIcon(conditions: string | null): string {
  if (!conditions) return 'cloud-outline';
  const c = conditions.toLowerCase();
  
  if (c.includes('thunder') || c.includes('storm')) return 'thunderstorm';
  if (c.includes('rain') || c.includes('shower')) return 'rainy';
  if (c.includes('snow') || c.includes('flurr')) return 'snow';
  if (c.includes('cloud') || c.includes('overcast')) return 'cloudy';
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'cloudy';
  if (c.includes('wind')) return 'flag';
  if (c.includes('clear') || c.includes('sunny') || c.includes('fair')) return 'sunny';
  return 'partly-sunny';
}

function calculateTotalDistance(waypoints: WaypointWeather[]): number {
  if (waypoints.length === 0) return 0;
  const last = waypoints[waypoints.length - 1];
  return last.waypoint.distance_from_start || 0;
}

function formatDuration(miles: number): string {
  const hours = Math.floor(miles / 55); // Average 55 mph
  const minutes = Math.round((miles / 55 - hours) * 60);
  return `${hours}h ${minutes}m`;
}

export default function RouteScreen() {
  const params = useLocalSearchParams();
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [showWeatherPanel, setShowWeatherPanel] = useState(true);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (params.routeData) {
      try {
        const data = JSON.parse(params.routeData as string);
        setRouteData(data);
        
        // Schedule notification if severe weather
        if (data.has_severe_weather) {
          scheduleWeatherAlert(data);
        }
      } catch (e) {
        console.error('Error parsing route data:', e);
      }
    }
  }, [params.routeData]);

  const scheduleWeatherAlert = async (data: RouteData) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Weather Alert on Your Route',
          body: `Weather alerts detected between ${data.origin} and ${data.destination}. Check the app for details.`,
          data: { routeId: data.id },
        },
        trigger: null,
      });
    } catch (e) {
      console.error('Error scheduling notification:', e);
    }
  };

  if (!routeData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#eab308" />
          <Text style={styles.loadingText}>Loading route data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const routeCoordinates = decodePolyline(routeData.route_geometry);
  const allAlerts = routeData.waypoints.flatMap((wp) => wp.alerts);
  const uniqueAlerts = allAlerts.filter(
    (alert, index, self) => index === self.findIndex((a) => a.id === alert.id)
  );
  const totalDistance = calculateTotalDistance(routeData.waypoints);
  const hasAlerts = uniqueAlerts.length > 0;

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: routeCoordinates[Math.floor(routeCoordinates.length / 2)]?.latitude || 40,
          longitude: routeCoordinates[Math.floor(routeCoordinates.length / 2)]?.longitude || -95,
          latitudeDelta: 8,
          longitudeDelta: 8,
        }}
        onMapReady={() => {
          if (mapRef.current && routeCoordinates.length > 0) {
            setTimeout(() => {
              mapRef.current?.fitToCoordinates(routeCoordinates, {
                edgePadding: { top: 100, right: 50, bottom: 300, left: 50 },
                animated: true,
              });
            }, 100);
          }
        }}
      >
        {/* Route Line */}
        <Polyline
          coordinates={routeCoordinates}
          strokeColor="#ef4444"
          strokeWidth={4}
        />
        
        {/* Weather Markers */}
        {routeData.waypoints.map((wp, index) => (
          <Marker
            key={index}
            coordinate={{
              latitude: wp.waypoint.lat,
              longitude: wp.waypoint.lon,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[
              styles.markerContainer,
              wp.alerts.length > 0 && styles.markerAlert
            ]}>
              {wp.alerts.length > 0 ? (
                <Ionicons name="warning" size={16} color="#fff" />
              ) : wp.weather ? (
                <Text style={styles.markerTemp}>{wp.weather.temperature}°</Text>
              ) : (
                <Ionicons name="help" size={14} color="#fff" />
              )}
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Header */}
      <SafeAreaView style={styles.headerSafe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerRoute} numberOfLines={1}>
              {routeData.origin} → {routeData.destination}
            </Text>
            <Text style={styles.headerStats}>
              {Math.round(totalDistance)} mi • {formatDuration(totalDistance)}
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.toggleButton}
            onPress={() => setShowWeatherPanel(!showWeatherPanel)}
          >
            <Ionicons 
              name={showWeatherPanel ? 'chevron-down' : 'chevron-up'} 
              size={24} 
              color="#fff" 
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Alert Banner */}
      {hasAlerts && (
        <View style={styles.alertBanner}>
          <Ionicons name="warning" size={18} color="#fff" />
          <Text style={styles.alertBannerText}>
            Weather alerts detected along your route!
          </Text>
        </View>
      )}

      {/* Weather Panel */}
      {showWeatherPanel && (
        <View style={styles.weatherPanel}>
          <ScrollView 
            style={styles.weatherScroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Weather Summary Card */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryHeader}>
                <View style={styles.summaryTitleRow}>
                  {hasAlerts && (
                    <Ionicons name="warning" size={20} color="#ef4444" />
                  )}
                  <Text style={styles.summaryTitle}>Weather Summary</Text>
                </View>
              </View>

              {hasAlerts && (
                <View style={styles.alertsDetectedBanner}>
                  <Ionicons name="warning" size={16} color="#fff" />
                  <Text style={styles.alertsDetectedText}>Weather Alerts Detected</Text>
                </View>
              )}

              {routeData.ai_summary && !routeData.ai_summary.includes('unavailable') ? (
                <Text style={styles.summaryText}>{routeData.ai_summary}</Text>
              ) : (
                <Text style={styles.summaryText}>
                  {hasAlerts 
                    ? 'Exercise caution on your route. Weather alerts have been issued for areas along your path. Check individual waypoints for specific conditions.'
                    : 'Weather conditions are generally favorable along your route. Check individual waypoints for specific conditions.'}
                </Text>
              )}
            </View>

            {/* Waypoint Weather Cards */}
            {routeData.waypoints.map((wp, index) => (
              <View key={index} style={styles.waypointCard}>
                <View style={styles.waypointHeader}>
                  <View style={styles.waypointLabel}>
                    <Text style={styles.waypointName}>
                      {index === 0 ? 'START' : index === routeData.waypoints.length - 1 ? 'END' : `POINT ${index}`}
                    </Text>
                    {wp.alerts.length > 0 && (
                      <View style={styles.alertBadge}>
                        <Ionicons name="warning" size={12} color="#fff" />
                      </View>
                    )}
                  </View>
                  {wp.waypoint.distance_from_start !== null && wp.waypoint.distance_from_start > 0 && (
                    <Text style={styles.waypointDistance}>
                      {Math.round(wp.waypoint.distance_from_start)} mi
                    </Text>
                  )}
                </View>

                {wp.weather ? (
                  <View style={styles.weatherContent}>
                    <View style={styles.tempSection}>
                      <Ionicons 
                        name={getWeatherIcon(wp.weather.conditions) as any} 
                        size={36} 
                        color="#eab308" 
                      />
                      <Text style={styles.temperature}>
                        {wp.weather.temperature}°{wp.weather.temperature_unit}
                      </Text>
                    </View>
                    <Text style={styles.conditions}>{wp.weather.conditions || 'Unknown'}</Text>
                    
                    <View style={styles.weatherDetails}>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="weather-windy" size={18} color="#a1a1aa" />
                        <Text style={styles.detailText}>
                          {wp.weather.wind_speed || 'N/A'}
                        </Text>
                      </View>
                      {wp.weather.humidity && (
                        <View style={styles.detailItem}>
                          <Ionicons name="water" size={18} color="#a1a1aa" />
                          <Text style={styles.detailText}>{wp.weather.humidity}%</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ) : (
                  <View style={styles.noWeather}>
                    <Ionicons name="cloud-offline" size={32} color="#52525b" />
                    <Text style={styles.noWeatherText}>Weather unavailable</Text>
                  </View>
                )}

                {/* Alert Tags */}
                {wp.alerts.length > 0 && (
                  <View style={styles.alertTags}>
                    {wp.alerts.slice(0, 2).map((alert, alertIndex) => (
                      <View key={alertIndex} style={styles.alertTag}>
                        <Text style={styles.alertTagText} numberOfLines={1}>
                          {alert.event}
                        </Text>
                      </View>
                    ))}
                    {wp.alerts.length > 2 && (
                      <View style={styles.alertTag}>
                        <Text style={styles.alertTagText}>+{wp.alerts.length - 2} more</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
  },
  loadingText: {
    color: '#a1a1aa',
    marginTop: 16,
    fontSize: 16,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  headerSafe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(39, 39, 42, 0.95)',
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
  },
  headerRoute: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  headerStats: {
    color: '#a1a1aa',
    fontSize: 13,
    marginTop: 2,
  },
  toggleButton: {
    padding: 8,
  },
  alertBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 80,
    left: 12,
    right: 12,
    backgroundColor: '#dc2626',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
    zIndex: 10,
  },
  alertBannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  markerContainer: {
    backgroundColor: '#3b82f6',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: '#fff',
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerAlert: {
    backgroundColor: '#dc2626',
  },
  markerTemp: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  weatherPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '55%',
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  weatherScroll: {
    padding: 16,
  },
  summaryCard: {
    backgroundColor: '#5b2133',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  summaryHeader: {
    marginBottom: 12,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  alertsDetectedBanner: {
    backgroundColor: '#dc2626',
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  alertsDetectedText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  summaryText: {
    color: '#e4e4e7',
    fontSize: 14,
    lineHeight: 20,
  },
  waypointCard: {
    backgroundColor: '#5b2133',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  waypointHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  waypointLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waypointName: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  alertBadge: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    padding: 4,
  },
  waypointDistance: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  weatherContent: {
    marginBottom: 8,
  },
  tempSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  temperature: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '700',
  },
  conditions: {
    color: '#e4e4e7',
    fontSize: 15,
    marginBottom: 10,
  },
  weatherDetails: {
    flexDirection: 'row',
    gap: 20,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    color: '#a1a1aa',
    fontSize: 14,
  },
  noWeather: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  noWeatherText: {
    color: '#52525b',
    fontSize: 14,
    marginTop: 8,
  },
  alertTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
  },
  alertTag: {
    backgroundColor: 'rgba(220, 38, 38, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  alertTagText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '500',
  },
});
