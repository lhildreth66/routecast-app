import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import * as Sharing from 'expo-sharing';
import { format, parseISO } from 'date-fns';

const { width, height } = Dimensions.get('window');

interface HourlyForecast {
  time: string;
  temperature: number;
  conditions: string;
  wind_speed: string;
  precipitation_chance?: number;
}

interface WeatherData {
  temperature: number | null;
  temperature_unit: string;
  wind_speed: string | null;
  wind_direction: string | null;
  conditions: string | null;
  icon: string | null;
  humidity: number | null;
  is_daytime: boolean;
  sunrise?: string;
  sunset?: string;
  hourly_forecast?: HourlyForecast[];
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
  eta_minutes?: number;
  arrival_time?: string;
}

interface WaypointWeather {
  waypoint: Waypoint;
  weather: WeatherData | null;
  alerts: WeatherAlert[];
  error: string | null;
}

interface PackingSuggestion {
  item: string;
  reason: string;
  priority: string;
}

interface StopPoint {
  location: string;
  type: string;
}

interface HazardAlert {
  type: string;
  severity: string;
  distance_miles: number;
  eta_minutes: number;
  message: string;
  recommendation: string;
  countdown_text: string;
}

interface RestStop {
  name: string;
  type: string;
  lat: number;
  lon: number;
  distance_miles: number;
  eta_minutes: number;
  weather_at_arrival: string | null;
  temperature_at_arrival: number | null;
  recommendation: string;
}

interface DepartureWindow {
  departure_time: string;
  arrival_time: string;
  safety_score: number;
  hazard_count: number;
  recommendation: string;
  conditions_summary: string;
}

interface SafetyScore {
  overall_score: number;
  risk_level: string;
  vehicle_type: string;
  factors: string[];
  recommendations: string[];
}

interface RouteData {
  id: string;
  origin: string;
  destination: string;
  stops?: StopPoint[];
  departure_time?: string;
  total_duration_minutes?: number;
  route_geometry: string;
  waypoints: WaypointWeather[];
  ai_summary: string | null;
  has_severe_weather: boolean;
  packing_suggestions?: PackingSuggestion[];
  weather_timeline?: HourlyForecast[];
  created_at: string;
  // New fields
  safety_score?: SafetyScore;
  hazard_alerts?: HazardAlert[];
  rest_stops?: RestStop[];
  optimal_departure?: DepartureWindow;
  trucker_warnings?: string[];
  vehicle_type?: string;
}

// Decode polyline utility
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
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

    points.push([lat / 1e5, lng / 1e5]);
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

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'essential': return '#ef4444';
    case 'recommended': return '#f59e0b';
    case 'optional': return '#22c55e';
    default: return '#6b7280';
  }
}

// Generate HTML for WebView map
function generateMapHtml(routeGeometry: string, waypoints: WaypointWeather[], showAlertMarkers: boolean = true): string {
  const routeCoords = decodePolyline(routeGeometry);
  const center = routeCoords[Math.floor(routeCoords.length / 2)];
  
  const alertWaypoints = waypoints.filter(wp => wp.alerts.length > 0);
  
  const markersJs = showAlertMarkers && alertWaypoints.length > 0 ? alertWaypoints.map((wp, idx) => {
    return `
      (function() {
        var icon = L.divIcon({
          className: '',
          html: '<div style="width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:22px solid #dc2626;position:relative;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));"><span style="position:absolute;top:6px;left:-4px;color:#fff;font-size:14px;font-weight:bold;">!</span></div>',
          iconSize: [24, 22],
          iconAnchor: [12, 22]
        });
        L.marker([${wp.waypoint.lat}, ${wp.waypoint.lon}], {icon: icon}).addTo(map);
      })();
    `;
  }).join('\n') : '';

  const startEndMarkers = `
    (function() {
      var startIcon = L.divIcon({
        className: '',
        html: '<div style="background:#22c55e;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.4);"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker([${routeCoords[0][0]}, ${routeCoords[0][1]}], {icon: startIcon}).addTo(map);
    })();
    
    (function() {
      var endIcon = L.divIcon({
        className: '',
        html: '<div style="background:#ef4444;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.4);"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker([${routeCoords[routeCoords.length - 1][0]}, ${routeCoords[routeCoords.length - 1][1]}], {icon: endIcon}).addTo(map);
    })();
  `;

  const routeCoordsJs = routeCoords.map(c => `[${c[0]}, ${c[1]}]`).join(',');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body, #map { width: 100%; height: 100%; background: #1a1a1a; }
        .leaflet-div-icon { background: transparent !important; border: none !important; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { 
          zoomControl: false,
          attributionControl: false
        }).setView([${center[0]}, ${center[1]}], 6);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 19
        }).addTo(map);
        
        var routeCoords = [${routeCoordsJs}];
        
        L.polyline(routeCoords, {
          color: '#ff6b6b',
          weight: 8,
          opacity: 0.3
        }).addTo(map);
        
        L.polyline(routeCoords, {
          color: '#ef4444',
          weight: 4,
          opacity: 1
        }).addTo(map);
        
        ${startEndMarkers}
        ${markersJs}
        
        var bounds = L.latLngBounds(routeCoords);
        map.fitBounds(bounds, { padding: [50, 50] });
      </script>
    </body>
    </html>
  `;
}

export default function RouteScreen() {
  const params = useLocalSearchParams();
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [showWeatherPanel, setShowWeatherPanel] = useState(true);
  const [showAlertMarkers, setShowAlertMarkers] = useState(true);
  const [activeTab, setActiveTab] = useState<'weather' | 'timeline' | 'packing'>('weather');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingWaypointIndex, setSpeakingWaypointIndex] = useState<number | null>(null);

  useEffect(() => {
    if (params.routeData) {
      try {
        const data = JSON.parse(params.routeData as string);
        setRouteData(data);
        
        if (data.has_severe_weather && Platform.OS !== 'web') {
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

  const speakSummary = async () => {
    if (!routeData) return;
    
    if (isSpeaking) {
      await Speech.stop();
      setIsSpeaking(false);
    } else {
      setIsSpeaking(true);
      
      // Calculate alerts locally
      const allAlertsLocal = routeData.waypoints.flatMap((wp) => wp.alerts);
      const uniqueAlertsLocal = allAlertsLocal.filter(
        (alert, index, self) => index === self.findIndex((a) => a.id === alert.id)
      );
      const hasAlertsLocal = uniqueAlertsLocal.length > 0;
      
      // Build comprehensive weather briefing
      const parts: string[] = [];
      
      // Introduction
      parts.push(`Weather briefing for your trip from ${routeData.origin} to ${routeData.destination}.`);
      
      // Duration and distance
      const totalDist = calculateTotalDistance(routeData.waypoints);
      const duration = routeData.total_duration_minutes 
        ? `${Math.floor(routeData.total_duration_minutes / 60)} hours and ${Math.round(routeData.total_duration_minutes % 60)} minutes`
        : `approximately ${Math.floor(totalDist / 55)} hours`;
      parts.push(`Total distance is ${Math.round(totalDist)} miles, taking ${duration}.`);
      
      // Weather alerts warning
      if (hasAlertsLocal) {
        parts.push(`Warning: There are ${uniqueAlertsLocal.length} weather alerts along your route. Please use caution.`);
      }
      
      // Weather at each waypoint
      parts.push(`Here's the weather along your route:`);
      
      routeData.waypoints.forEach((wp, index) => {
        if (wp.weather) {
          const locationName = wp.waypoint.name || (index === 0 ? 'Starting point' : `Point ${index}`);
          const temp = wp.weather.temperature;
          const conditions = wp.weather.conditions || 'unknown conditions';
          const wind = wp.weather.wind_speed || 'calm winds';
          
          let wpText = `${locationName}: ${temp} degrees, ${conditions}, with ${wind}.`;
          
          // Add alert info for this waypoint
          if (wp.alerts.length > 0) {
            wpText += ` Alert: ${wp.alerts[0].event}.`;
          }
          
          parts.push(wpText);
        }
      });
      
      // Packing suggestions
      if (routeData.packing_suggestions && routeData.packing_suggestions.length > 0) {
        const essentialItems = routeData.packing_suggestions
          .filter(p => p.priority === 'essential')
          .map(p => p.item);
        
        if (essentialItems.length > 0) {
          parts.push(`Essential items to pack: ${essentialItems.join(', ')}.`);
        }
      }
      
      // Sunrise/sunset
      const sunTimesLocal = routeData.waypoints.find(wp => wp.weather?.sunrise)?.weather;
      if (sunTimesLocal?.sunrise && sunTimesLocal?.sunset) {
        parts.push(`Sunrise is at ${sunTimesLocal.sunrise}, sunset at ${sunTimesLocal.sunset}.`);
      }
      
      // AI Summary or closing
      if (routeData.ai_summary && !routeData.ai_summary.includes('unavailable')) {
        parts.push(routeData.ai_summary);
      } else {
        parts.push('Drive safely and check conditions before departing.');
      }
      
      const fullText = parts.join(' ');
      
      Speech.speak(fullText, {
        language: 'en-US',
        pitch: 1.0,
        rate: 0.9, // Slightly slower for clarity
        onDone: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    }
  };

  const shareRoute = async () => {
    if (!routeData) return;
    
    const temps = routeData.waypoints
      .filter(wp => wp.weather?.temperature)
      .map(wp => `${wp.waypoint.name}: ${wp.weather?.temperature}°F ${wp.weather?.conditions}`)
      .join('\n');
    
    const message = `🚗 Routecast Weather Report\n\n📍 ${routeData.origin} → ${routeData.destination}\n⏱ ${routeData.total_duration_minutes ? formatDuration(routeData.total_duration_minutes) : 'N/A'}\n\n🌤 Weather:\n${temps}\n\n${routeData.ai_summary || ''}`;
    
    try {
      await Share.share({
        message,
        title: 'Routecast Weather Report',
      });
    } catch (e) {
      console.error('Error sharing:', e);
    }
  };

  // Speak individual waypoint weather
  const speakWaypointWeather = async (wp: WaypointWeather, index: number) => {
    // Stop if already speaking this waypoint
    if (speakingWaypointIndex === index) {
      await Speech.stop();
      setSpeakingWaypointIndex(null);
      setIsSpeaking(false);
      return;
    }
    
    // Stop any current speech
    await Speech.stop();
    setIsSpeaking(true);
    setSpeakingWaypointIndex(index);
    
    const parts: string[] = [];
    const locationName = wp.waypoint.name || `Point ${index + 1}`;
    
    // Location intro
    parts.push(`Weather for ${locationName}.`);
    
    // Distance and ETA info
    if (wp.waypoint.distance_from_start && wp.waypoint.distance_from_start > 0) {
      parts.push(`${Math.round(wp.waypoint.distance_from_start)} miles from start.`);
    }
    if (wp.waypoint.eta_minutes && wp.waypoint.eta_minutes > 0) {
      const hours = Math.floor(wp.waypoint.eta_minutes / 60);
      const mins = Math.round(wp.waypoint.eta_minutes % 60);
      if (hours > 0) {
        parts.push(`Estimated arrival in ${hours} hours and ${mins} minutes.`);
      } else {
        parts.push(`Estimated arrival in ${mins} minutes.`);
      }
    }
    
    // Weather conditions
    if (wp.weather) {
      const temp = wp.weather.temperature;
      const conditions = wp.weather.conditions || 'unknown conditions';
      const wind = wp.weather.wind_speed || 'calm winds';
      const humidity = wp.weather.humidity;
      
      parts.push(`Current temperature is ${temp} degrees Fahrenheit, ${conditions}.`);
      parts.push(`Wind ${wind}.`);
      
      if (humidity) {
        parts.push(`Humidity at ${humidity} percent.`);
      }
    } else {
      parts.push('Weather data is currently unavailable for this location.');
    }
    
    // Weather alerts
    if (wp.alerts.length > 0) {
      parts.push(`Warning: ${wp.alerts.length} weather alert${wp.alerts.length > 1 ? 's' : ''} at this location.`);
      wp.alerts.forEach((alert, i) => {
        parts.push(`Alert ${i + 1}: ${alert.event}. ${alert.headline}`);
      });
    }
    
    const fullText = parts.join(' ');
    
    Speech.speak(fullText, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.9,
      onDone: () => {
        setSpeakingWaypointIndex(null);
        setIsSpeaking(false);
      },
      onError: () => {
        setSpeakingWaypointIndex(null);
        setIsSpeaking(false);
      },
    });
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

  const allAlerts = routeData.waypoints.flatMap((wp) => wp.alerts);
  const uniqueAlerts = allAlerts.filter(
    (alert, index, self) => index === self.findIndex((a) => a.id === alert.id)
  );
  const totalDistance = calculateTotalDistance(routeData.waypoints);
  const hasAlerts = uniqueAlerts.length > 0;
  const mapHtml = generateMapHtml(routeData.route_geometry, routeData.waypoints, showAlertMarkers);

  // Get first waypoint with sunrise/sunset
  const sunTimes = routeData.waypoints.find(wp => wp.weather?.sunrise)?.weather;

  return (
    <View style={styles.container}>
      {/* Map */}
      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          <iframe
            srcDoc={mapHtml}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Route Map"
          />
        ) : (
          <WebView
            style={styles.map}
            source={{ html: mapHtml }}
            scrollEnabled={false}
            javaScriptEnabled={true}
          />
        )}
      </View>

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
              {Math.round(totalDistance)} mi • {routeData.total_duration_minutes ? formatDuration(routeData.total_duration_minutes) : formatDuration(totalDistance / 55 * 60)}
            </Text>
          </View>
          <TouchableOpacity 
            style={[styles.markerToggle, !showAlertMarkers && styles.markerToggleOff]}
            onPress={() => setShowAlertMarkers(!showAlertMarkers)}
          >
            <Ionicons 
              name="warning" 
              size={20} 
              color={showAlertMarkers ? '#ef4444' : '#6b7280'} 
            />
          </TouchableOpacity>
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
          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.actionButton} onPress={speakSummary}>
              <Ionicons 
                name={isSpeaking ? "stop-circle" : "volume-high"} 
                size={20} 
                color="#60a5fa" 
              />
              <Text style={styles.actionButtonText}>
                {isSpeaking ? 'Stop' : 'Listen'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={shareRoute}>
              <Ionicons name="share-outline" size={20} color="#60a5fa" />
              <Text style={styles.actionButtonText}>Share</Text>
            </TouchableOpacity>
            {sunTimes && (
              <View style={styles.sunTimes}>
                <View style={styles.sunTimeItem}>
                  <Ionicons name="sunny" size={14} color="#f59e0b" />
                  <Text style={styles.sunTimeText}>{sunTimes.sunrise}</Text>
                </View>
                <View style={styles.sunTimeItem}>
                  <Ionicons name="moon" size={14} color="#8b5cf6" />
                  <Text style={styles.sunTimeText}>{sunTimes.sunset}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Tabs */}
          <View style={styles.tabs}>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'weather' && styles.tabActive]}
              onPress={() => setActiveTab('weather')}
            >
              <Ionicons name="cloud" size={16} color={activeTab === 'weather' ? '#eab308' : '#6b7280'} />
              <Text style={[styles.tabText, activeTab === 'weather' && styles.tabTextActive]}>Weather</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'timeline' && styles.tabActive]}
              onPress={() => setActiveTab('timeline')}
            >
              <Ionicons name="time" size={16} color={activeTab === 'timeline' ? '#eab308' : '#6b7280'} />
              <Text style={[styles.tabText, activeTab === 'timeline' && styles.tabTextActive]}>Timeline</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'packing' && styles.tabActive]}
              onPress={() => setActiveTab('packing')}
            >
              <Ionicons name="bag" size={16} color={activeTab === 'packing' ? '#eab308' : '#6b7280'} />
              <Text style={[styles.tabText, activeTab === 'packing' && styles.tabTextActive]}>Packing</Text>
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.weatherScroll}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === 'weather' && (
              <>
                {/* Weather Summary Card */}
                <View style={styles.summaryCard}>
                  <View style={styles.summaryHeader}>
                    <View style={styles.summaryTitleRow}>
                      {hasAlerts && (
                        <Ionicons name="warning" size={20} color="#ef4444" />
                      )}
                      <Text style={styles.summaryTitle}>AI Weather Summary</Text>
                    </View>
                  </View>

                  {hasAlerts && (
                    <View style={styles.alertsDetectedBanner}>
                      <Ionicons name="warning" size={16} color="#fff" />
                      <Text style={styles.alertsDetectedText}>Weather Alerts Detected</Text>
                    </View>
                  )}

                  <Text style={styles.summaryText}>
                    {routeData.ai_summary || 'Weather conditions are generally favorable along your route. Check individual waypoints for specific conditions.'}
                  </Text>
                </View>

                {/* Waypoint Weather Cards */}
                {routeData.waypoints.map((wp, index) => (
                  <View key={index} style={styles.waypointCard}>
                    <View style={styles.waypointHeader}>
                      <View style={styles.waypointLabel}>
                        <Text style={styles.waypointName} numberOfLines={1}>
                          {wp.waypoint.name || (index === 0 ? 'Start' : index === routeData.waypoints.length - 1 ? 'End' : `Point ${index}`)}
                        </Text>
                        {wp.alerts.length > 0 && (
                          <View style={styles.alertBadge}>
                            <Ionicons name="warning" size={12} color="#fff" />
                          </View>
                        )}
                      </View>
                      <View style={styles.waypointHeaderRight}>
                        <View style={styles.waypointMeta}>
                          {wp.waypoint.distance_from_start !== null && wp.waypoint.distance_from_start > 0 && (
                            <Text style={styles.waypointDistance}>
                              {Math.round(wp.waypoint.distance_from_start)} mi
                            </Text>
                          )}
                          {wp.waypoint.arrival_time && (
                            <Text style={styles.waypointEta}>
                              ETA {format(parseISO(wp.waypoint.arrival_time), 'h:mm a')}
                            </Text>
                          )}
                        </View>
                        {/* Speaker Button for Individual Waypoint */}
                        <TouchableOpacity 
                          style={[
                            styles.waypointSpeakerButton,
                            speakingWaypointIndex === index && styles.waypointSpeakerButtonActive
                          ]}
                          onPress={() => speakWaypointWeather(wp, index)}
                        >
                          <Ionicons 
                            name={speakingWaypointIndex === index ? "stop-circle" : "volume-medium-outline"} 
                            size={18} 
                            color={speakingWaypointIndex === index ? "#ef4444" : "#60a5fa"} 
                          />
                        </TouchableOpacity>
                      </View>
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

                    {wp.alerts.length > 0 && (
                      <View style={styles.alertTags}>
                        {wp.alerts.slice(0, 2).map((alert, alertIndex) => (
                          <View key={alertIndex} style={styles.alertTag}>
                            <Text style={styles.alertTagText} numberOfLines={1}>
                              {alert.event}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}

            {activeTab === 'timeline' && (
              <View style={styles.timelineContainer}>
                <Text style={styles.timelineTitle}>Hourly Weather Timeline</Text>
                {routeData.weather_timeline && routeData.weather_timeline.length > 0 ? (
                  routeData.weather_timeline.map((hour, index) => (
                    <View key={index} style={styles.timelineItem}>
                      <Text style={styles.timelineTime}>
                        {hour.time ? format(parseISO(hour.time), 'h a') : '--'}
                      </Text>
                      <View style={styles.timelineWeather}>
                        <Ionicons 
                          name={getWeatherIcon(hour.conditions) as any} 
                          size={24} 
                          color="#eab308" 
                        />
                        <Text style={styles.timelineTemp}>{hour.temperature}°</Text>
                      </View>
                      <Text style={styles.timelineConditions} numberOfLines={1}>
                        {hour.conditions}
                      </Text>
                      <Text style={styles.timelineWind}>{hour.wind_speed}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noDataText}>No timeline data available</Text>
                )}
              </View>
            )}

            {activeTab === 'packing' && (
              <View style={styles.packingContainer}>
                <Text style={styles.packingTitle}>Packing Suggestions</Text>
                <Text style={styles.packingSubtitle}>Based on weather along your route</Text>
                
                {routeData.packing_suggestions && routeData.packing_suggestions.length > 0 ? (
                  routeData.packing_suggestions.map((item, index) => (
                    <View key={index} style={styles.packingItem}>
                      <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(item.priority) }]} />
                      <View style={styles.packingInfo}>
                        <Text style={styles.packingItemName}>{item.item}</Text>
                        <Text style={styles.packingReason}>{item.reason}</Text>
                      </View>
                      <View style={[styles.priorityBadge, { backgroundColor: `${getPriorityColor(item.priority)}20` }]}>
                        <Text style={[styles.priorityText, { color: getPriorityColor(item.priority) }]}>
                          {item.priority}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noDataText}>No packing suggestions available</Text>
                )}
              </View>
            )}
            
            <View style={{ height: 40 }} />
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
  mapContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    flex: 1,
    backgroundColor: '#1a1a1a',
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(39, 39, 42, 0.95)',
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 12,
  },
  backButton: {
    padding: 6,
    marginRight: 6,
  },
  headerInfo: {
    flex: 1,
  },
  headerRoute: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  headerStats: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  markerToggle: {
    padding: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 8,
    marginRight: 4,
  },
  markerToggleOff: {
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
  toggleButton: {
    padding: 6,
  },
  alertBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 75,
    left: 10,
    right: 10,
    backgroundColor: '#dc2626',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 8,
    zIndex: 10,
  },
  alertBannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  weatherPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '58%',
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 12,
    alignItems: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionButtonText: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '500',
  },
  sunTimes: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  sunTimeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sunTimeText: {
    color: '#a1a1aa',
    fontSize: 11,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    backgroundColor: '#27272a',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#3f3f46',
  },
  tabText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#eab308',
  },
  weatherScroll: {
    paddingHorizontal: 16,
  },
  summaryCard: {
    backgroundColor: '#5b2133',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  summaryHeader: {
    marginBottom: 10,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  alertsDetectedBanner: {
    backgroundColor: '#dc2626',
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
    marginBottom: 10,
  },
  alertsDetectedText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryText: {
    color: '#e4e4e7',
    fontSize: 13,
    lineHeight: 19,
  },
  waypointCard: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  waypointHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  waypointLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waypointName: {
    color: '#eab308',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  alertBadge: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    padding: 3,
  },
  waypointMeta: {
    alignItems: 'flex-end',
  },
  waypointHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waypointSpeakerButton: {
    padding: 8,
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    borderRadius: 8,
  },
  waypointSpeakerButtonActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  waypointDistance: {
    color: '#a1a1aa',
    fontSize: 11,
  },
  waypointEta: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '500',
  },
  weatherContent: {
    marginBottom: 6,
  },
  tempSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 2,
  },
  temperature: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  conditions: {
    color: '#e4e4e7',
    fontSize: 14,
    marginBottom: 8,
  },
  weatherDetails: {
    flexDirection: 'row',
    gap: 16,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  detailText: {
    color: '#a1a1aa',
    fontSize: 13,
  },
  noWeather: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  noWeatherText: {
    color: '#52525b',
    fontSize: 13,
    marginTop: 6,
  },
  alertTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 10,
  },
  alertTag: {
    backgroundColor: 'rgba(220, 38, 38, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  alertTagText: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '500',
  },
  timelineContainer: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    padding: 14,
  },
  timelineTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#3f3f46',
  },
  timelineTime: {
    color: '#a1a1aa',
    fontSize: 12,
    width: 50,
  },
  timelineWeather: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 70,
  },
  timelineTemp: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  timelineConditions: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 12,
  },
  timelineWind: {
    color: '#a1a1aa',
    fontSize: 11,
    width: 60,
    textAlign: 'right',
  },
  packingContainer: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    padding: 14,
  },
  packingTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  packingSubtitle: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 14,
  },
  packingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#3f3f46',
    gap: 10,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  packingInfo: {
    flex: 1,
  },
  packingItemName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  packingReason: {
    color: '#a1a1aa',
    fontSize: 11,
    marginTop: 2,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  noDataText: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  webMapPlaceholder: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webMapText: {
    color: '#52525b',
    fontSize: 14,
    marginTop: 12,
  },
});
