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
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import MapView, { Polyline, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Notifications from 'expo-notifications';

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

function getWeatherIcon(conditions: string | null, isDaytime: boolean): string {
  if (!conditions) return isDaytime ? 'sunny' : 'moon';
  const c = conditions.toLowerCase();
  
  if (c.includes('thunder') || c.includes('storm')) return 'thunderstorm';
  if (c.includes('rain') || c.includes('shower')) return 'rainy';
  if (c.includes('snow') || c.includes('flurr')) return 'snow';
  if (c.includes('cloud') || c.includes('overcast')) return isDaytime ? 'partly-sunny' : 'cloudy-night';
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'cloudy';
  if (c.includes('wind')) return 'flag';
  if (c.includes('clear') || c.includes('sunny') || c.includes('fair')) {
    return isDaytime ? 'sunny' : 'moon';
  }
  return isDaytime ? 'partly-sunny' : 'cloudy-night';
}

function getSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'extreme': return '#dc2626';
    case 'severe': return '#ea580c';
    case 'moderate': return '#f59e0b';
    case 'minor': return '#84cc16';
    default: return '#6b7280';
  }
}

export default function RouteScreen() {
  const params = useLocalSearchParams();
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<number>(0);
  const [showAlerts, setShowAlerts] = useState(false);
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
          title: '⚠️ Weather Alert on Your Route',
          body: `Severe weather detected between ${data.origin} and ${data.destination}. Check the app for details.`,
          data: { routeId: data.id },
        },
        trigger: null, // Immediate notification
      });
    } catch (e) {
      console.error('Error scheduling notification:', e);
    }
  };

  if (!routeData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60a5fa" />
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

  const selectedWp = routeData.waypoints[selectedWaypoint];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={styles.headerText} numberOfLines={1}>
            {routeData.origin}
          </Text>
          <Ionicons name="arrow-forward" size={16} color="#6b7280" />
          <Text style={styles.headerText} numberOfLines={1}>
            {routeData.destination}
          </Text>
        </View>
        {uniqueAlerts.length > 0 && (
          <TouchableOpacity
            style={styles.alertButton}
            onPress={() => setShowAlerts(!showAlerts)}
          >
            <Ionicons name="warning" size={22} color="#f59e0b" />
            <View style={styles.alertBadge}>
              <Text style={styles.alertBadgeText}>{uniqueAlerts.length}</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={{
            latitude: routeCoordinates[Math.floor(routeCoordinates.length / 2)]?.latitude || 40,
            longitude: routeCoordinates[Math.floor(routeCoordinates.length / 2)]?.longitude || -95,
            latitudeDelta: 5,
            longitudeDelta: 5,
          }}
          onMapReady={() => {
            if (mapRef.current && routeCoordinates.length > 0) {
              mapRef.current.fitToCoordinates(routeCoordinates, {
                edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                animated: true,
              });
            }
          }}
        >
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#3b82f6"
            strokeWidth={4}
          />
          {routeData.waypoints.map((wp, index) => (
            <Marker
              key={index}
              coordinate={{
                latitude: wp.waypoint.lat,
                longitude: wp.waypoint.lon,
              }}
              onPress={() => setSelectedWaypoint(index)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View
                style={[
                  styles.markerContainer,
                  selectedWaypoint === index && styles.markerSelected,
                  wp.alerts.length > 0 && styles.markerAlert,
                ]}
              >
                {wp.weather ? (
                  <Text style={styles.markerTemp}>
                    {wp.weather.temperature}°
                  </Text>
                ) : (
                  <Ionicons name="help" size={14} color="#fff" />
                )}
              </View>
            </Marker>
          ))}
        </MapView>
      </View>

      {/* AI Summary */}
      {routeData.ai_summary && (
        <View style={styles.summaryContainer}>
          <View style={styles.summaryHeader}>
            <Ionicons name="sparkles" size={18} color="#a855f7" />
            <Text style={styles.summaryTitle}>AI Weather Summary</Text>
          </View>
          <Text style={styles.summaryText}>{routeData.ai_summary}</Text>
        </View>
      )}

      {/* Waypoint Selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.waypointScroll}
      >
        {routeData.waypoints.map((wp, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.waypointTab,
              selectedWaypoint === index && styles.waypointTabActive,
            ]}
            onPress={() => {
              setSelectedWaypoint(index);
              if (mapRef.current) {
                mapRef.current.animateToRegion({
                  latitude: wp.waypoint.lat,
                  longitude: wp.waypoint.lon,
                  latitudeDelta: 1,
                  longitudeDelta: 1,
                });
              }
            }}
          >
            <Text
              style={[
                styles.waypointTabText,
                selectedWaypoint === index && styles.waypointTabTextActive,
              ]}
            >
              {wp.waypoint.name || `Point ${index + 1}`}
            </Text>
            {wp.alerts.length > 0 && (
              <View style={styles.waypointAlertDot} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Weather Details */}
      <ScrollView style={styles.detailsContainer}>
        {selectedWp?.weather ? (
          <View style={styles.weatherCard}>
            <View style={styles.weatherMain}>
              <Ionicons
                name={getWeatherIcon(selectedWp.weather.conditions, selectedWp.weather.is_daytime) as any}
                size={64}
                color="#60a5fa"
              />
              <View style={styles.tempContainer}>
                <Text style={styles.tempText}>
                  {selectedWp.weather.temperature}°{selectedWp.weather.temperature_unit}
                </Text>
                <Text style={styles.conditionsText}>
                  {selectedWp.weather.conditions || 'Unknown'}
                </Text>
              </View>
            </View>

            <View style={styles.weatherDetails}>
              <View style={styles.detailItem}>
                <Ionicons name="flag" size={20} color="#9ca3af" />
                <Text style={styles.detailLabel}>Wind</Text>
                <Text style={styles.detailValue}>
                  {selectedWp.weather.wind_speed || 'N/A'}
                  {selectedWp.weather.wind_direction ? ` ${selectedWp.weather.wind_direction}` : ''}
                </Text>
              </View>
              {selectedWp.weather.humidity && (
                <View style={styles.detailItem}>
                  <Ionicons name="water" size={20} color="#9ca3af" />
                  <Text style={styles.detailLabel}>Humidity</Text>
                  <Text style={styles.detailValue}>
                    {selectedWp.weather.humidity}%
                  </Text>
                </View>
              )}
              <View style={styles.detailItem}>
                <Ionicons name="navigate" size={20} color="#9ca3af" />
                <Text style={styles.detailLabel}>Distance</Text>
                <Text style={styles.detailValue}>
                  {selectedWp.waypoint.distance_from_start || 0} mi
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.noWeatherCard}>
            <Ionicons name="cloud-offline" size={48} color="#4b5563" />
            <Text style={styles.noWeatherText}>Weather data unavailable</Text>
          </View>
        )}

        {/* Alerts for selected waypoint */}
        {selectedWp?.alerts.length > 0 && (
          <View style={styles.alertsSection}>
            <Text style={styles.alertsSectionTitle}>Active Alerts</Text>
            {selectedWp.alerts.map((alert, index) => (
              <View key={index} style={styles.alertCard}>
                <View style={styles.alertHeader}>
                  <View
                    style={[
                      styles.severityBadge,
                      { backgroundColor: getSeverityColor(alert.severity) },
                    ]}
                  >
                    <Text style={styles.severityText}>{alert.severity}</Text>
                  </View>
                  <Text style={styles.alertEvent}>{alert.event}</Text>
                </View>
                <Text style={styles.alertHeadline}>{alert.headline}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Alerts Modal */}
      {showAlerts && (
        <View style={styles.alertsModal}>
          <View style={styles.alertsModalHeader}>
            <Text style={styles.alertsModalTitle}>All Route Alerts</Text>
            <TouchableOpacity onPress={() => setShowAlerts(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.alertsModalScroll}>
            {uniqueAlerts.map((alert, index) => (
              <View key={index} style={styles.alertCard}>
                <View style={styles.alertHeader}>
                  <View
                    style={[
                      styles.severityBadge,
                      { backgroundColor: getSeverityColor(alert.severity) },
                    ]}
                  >
                    <Text style={styles.severityText}>{alert.severity}</Text>
                  </View>
                  <Text style={styles.alertEvent}>{alert.event}</Text>
                </View>
                <Text style={styles.alertHeadline}>{alert.headline}</Text>
                {alert.areas && (
                  <Text style={styles.alertAreas}>Areas: {alert.areas}</Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9ca3af',
    marginTop: 16,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1f1f1f',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  alertButton: {
    padding: 8,
    position: 'relative',
  },
  alertBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  mapContainer: {
    height: 220,
    backgroundColor: '#1f1f1f',
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    backgroundColor: '#3b82f6',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: '#fff',
    minWidth: 36,
    alignItems: 'center',
  },
  markerSelected: {
    backgroundColor: '#2563eb',
    transform: [{ scale: 1.2 }],
  },
  markerAlert: {
    borderColor: '#f59e0b',
  },
  markerTemp: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  summaryContainer: {
    backgroundColor: '#1a1a2e',
    margin: 12,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#a855f7',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  summaryTitle: {
    color: '#a855f7',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryText: {
    color: '#d1d5db',
    fontSize: 14,
    lineHeight: 20,
  },
  waypointScroll: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  waypointTab: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  waypointTabActive: {
    backgroundColor: '#3b82f6',
  },
  waypointTabText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  waypointTabTextActive: {
    color: '#fff',
  },
  waypointAlertDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
    marginLeft: 6,
  },
  detailsContainer: {
    flex: 1,
    padding: 12,
  },
  weatherCard: {
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
  },
  weatherMain: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  tempContainer: {
    marginLeft: 20,
  },
  tempText: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
  },
  conditionsText: {
    color: '#9ca3af',
    fontSize: 18,
    marginTop: 4,
  },
  weatherDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 16,
  },
  detailItem: {
    alignItems: 'center',
    gap: 6,
  },
  detailLabel: {
    color: '#6b7280',
    fontSize: 12,
  },
  detailValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  noWeatherCard: {
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 12,
  },
  noWeatherText: {
    color: '#6b7280',
    fontSize: 16,
    marginTop: 12,
  },
  alertsSection: {
    marginTop: 8,
  },
  alertsSectionTitle: {
    color: '#f59e0b',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  alertCard: {
    backgroundColor: '#1f1f1f',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  severityText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  alertEvent: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  alertHeadline: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
  },
  alertAreas: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 8,
  },
  alertsModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
  },
  alertsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  alertsModalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  alertsModalScroll: {
    padding: 16,
  },
});
