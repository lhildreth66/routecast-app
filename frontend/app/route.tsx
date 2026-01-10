import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import axios from "axios";
import { getPremiumStatus } from "../utils/premium";
import { RouteMap } from "../components/RouteMap";

// Final, corrected version of the results screen (`route.tsx`)

type StopPoint = { location: string; type: "stop" };

type RouteWeatherRequest = {
  origin: string;
  destination: string;
  departure_time?: string;
  stops?: StopPoint[];
  check_bridges?: boolean;
  vehicle_height?: number;
  vehicle_height_unit?: string;
};

function normalizeApiRoot(raw: string) {
  let s = (raw || "").trim();
  if (!s) return "http://10.0.2.2:8000/api";
  while (s.endsWith("/")) s = s.slice(0, -1);
  if (!s.toLowerCase().endsWith("/api")) s = `${s}/api`;
  return s;
}

export default function RouteWeatherScreen() {
  const params = useLocalSearchParams<{
    origin?: string;
    destination?: string;
    stops?: string;
    departure?: string;
    checkBridges?: string;
    vehicleHeight?: string;
    vehicleHeightUnit?: string;
  }>();

  const origin = (params.origin || "").toString();
  const destination = (params.destination || "").toString();
  const checkBridges = (params.checkBridges || "").toString() === "1";
  const vehicleHeight = (params.vehicleHeight || "").toString();
  const vehicleHeightUnit = (params.vehicleHeightUnit || "feet").toString();

  const stops: StopPoint[] = useMemo(() => {
    try {
      const raw = (params.stops || "").toString();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((s: any) => ({
          location: String(s?.location || ""),
          type: "stop" as const,
        }))
        .filter((s) => s.location.trim().length > 0);
    } catch {
      return [];
    }
  }, [params.stops]);

  const departure = (params.departure || "").toString();
  const API_ROOT = useMemo(() => {
    const env =
      process.env.EXPO_PUBLIC_API_URL ||
      process.env.EXPO_PUBLIC_BACKEND_URL ||
      "https://routecast-app.onrender.com/api"; // Use Render backend for web

    console.log('[DEBUG] EXPO_PUBLIC_API_URL:', process.env.EXPO_PUBLIC_API_URL);
    console.log('[DEBUG] EXPO_PUBLIC_BACKEND_URL:', process.env.EXPO_PUBLIC_BACKEND_URL);
    console.log('[DEBUG] Using env:', env);
    console.log('[DEBUG] API_ROOT:', normalizeApiRoot(env));

    return normalizeApiRoot(env);
  }, []);

  const hitUrl = useMemo(() => `${API_ROOT}/route/weather`, [API_ROOT]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [weatherData, setWeatherData] = useState<any>(null);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    getPremiumStatus().then(status => setIsPremium(status.isPremium));
  }, []);

  const fetchRouteWeather = useCallback(async () => {
    setErrorMsg("");
    setWeatherData(null);

    const body: RouteWeatherRequest = {
      origin,
      destination,
      departure_time: departure || undefined,
      stops: stops.length ? stops : undefined,
      check_bridges: checkBridges,
      vehicle_height: checkBridges && vehicleHeight ? parseFloat(vehicleHeight) : undefined,
      vehicle_height_unit: vehicleHeightUnit,
    };

    try {
      setLoading(true);
      console.log(`[RouteWeather] Fetching from: ${hitUrl}`);
      console.log(`[RouteWeather] Request body:`, body);
      
      const res = await axios.post(hitUrl, body, {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      });

      console.log(`[RouteWeather] Response status: ${res.status}`);
      
      if (res.status >= 200 && res.status < 300) {
        console.log(`[RouteWeather] Success! Data received`);
        console.log(`[RouteWeather] Has waypoints: ${!!res.data.waypoints}, Count: ${res.data.waypoints?.length || 0}`);
        console.log(`[RouteWeather] Has bridge warnings: ${res.data.has_bridge_warnings}`);
        console.log(`[RouteWeather] Bridge clearances:`, res.data.bridge_clearances);
        setWeatherData(res.data);
      } else {
        console.error(`[RouteWeather] Unexpected status: ${res.status}`);
        setErrorMsg(`Received unexpected status: ${res.status}`);
      }
    } catch (err: any) {
      console.error(`[RouteWeather] Full error:`, err);
      console.error(`[RouteWeather] Error message:`, err?.message);
      console.error(`[RouteWeather] Response:`, err?.response);
      console.error(`[RouteWeather] Response data:`, err?.response?.data);
      console.error(`[RouteWeather] Response status:`, err?.response?.status);

      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        "Request failed";

      console.error(`[RouteWeather] Error:`, {
        status,
        detail,
        url: hitUrl,
        error: err
      });
      
      setErrorMsg(`(${status || "?"}) ${detail}`);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, stops, departure, hitUrl]);

  useFocusEffect(
    useCallback(() => {
      if (origin.trim() && destination.trim()) {
        fetchRouteWeather();
      }
    }, [origin, destination, fetchRouteWeather])
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Route Weather</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.label}>Route</Text>
          <Text style={styles.routeText}>
            {origin || "?"} → {destination || "?"}
          </Text>

          {!!stops.length && (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Stops</Text>
              {stops.map((s, i) => (
                <Text key={`${s.location}-${i}`} style={styles.subText}>
                  • {s.location}
                </Text>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
            onPress={fetchRouteWeather}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>
              {loading ? "Loading..." : "Refresh"}
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.subText}>Fetching route weather…</Text>
          </View>
        ) : errorMsg ? (
          <View style={styles.card}>
            <Text style={styles.errorTitle}>Couldn't load route weather</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : weatherData ? (
          <>
            {/* Route Map */}
            {weatherData.waypoints && weatherData.waypoints.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>🗺️ Route Map</Text>
                <RouteMap
                  routeGeometry={weatherData.route_geometry || ''}
                  waypoints={weatherData.waypoints.map((wp: any) => ({
                    lat: wp.waypoint?.lat || 0,
                    lon: wp.waypoint?.lon || 0,
                    weather: wp.weather,
                  }))}
                  origin={origin}
                  destination={destination}
                />
              </View>
            )}

            {/* Bridge Warnings */}
            {weatherData.has_bridge_warnings && weatherData.bridge_clearances && weatherData.bridge_clearances.length > 0 && (
              <View style={[styles.card, styles.alertCard]}>
                <Text style={styles.alertTitle}>🌉 Bridge Clearance Warnings</Text>
                {weatherData.bridge_clearances.map((bridge: any, idx: number) => (
                  <View key={idx} style={styles.bridgeWarning}>
                    <Text style={styles.bridgeLocation}>
                      📍 {bridge.location || `Bridge at mile ${bridge.distance_miles?.toFixed(1) || 0}`}
                    </Text>
                    <Text style={styles.bridgeClearance}>
                      Clearance: {bridge.clearance_feet?.toFixed(1) || 'Unknown'} ft
                    </Text>
                    {bridge.clearance_feet < vehicleHeight && (
                      <Text style={styles.bridgeDanger}>
                        ⚠️ TOO LOW for your vehicle ({vehicleHeight} ft)
                      </Text>
                    )}
                    {bridge.warning_message && (
                      <Text style={styles.bridgeMessage}>{bridge.warning_message}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* AI Summary */}
            {weatherData.ai_summary && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>🤖 AI Trip Summary</Text>
                <Text style={styles.aiText}>{weatherData.ai_summary}</Text>
              </View>
            )}

            {/* Delay Risk Score - PREMIUM */}
            {weatherData.delay_risk_score && (
              isPremium ? (
                <View style={[
                  styles.card,
                  styles.riskCard,
                  weatherData.delay_risk_score.risk_level === 'critical' && styles.riskCardCritical,
                  weatherData.delay_risk_score.risk_level === 'high' && styles.riskCardHigh,
                  weatherData.delay_risk_score.risk_level === 'medium' && styles.riskCardMedium,
                ]}>
                  <Text style={styles.sectionTitle}>🎯 Delay Risk Score</Text>
                  <View style={styles.riskScoreContainer}>
                    <Text style={styles.riskPercent}>{weatherData.delay_risk_score.overall_risk_percent}%</Text>
                    <Text style={styles.riskLevel}>
                      {weatherData.delay_risk_score.risk_level.toUpperCase()} RISK
                    </Text>
                  </View>
                  {weatherData.delay_risk_score.estimated_delay_minutes > 0 && (
                    <Text style={styles.riskDelay}>
                      ⏱️ Estimated delay: {weatherData.delay_risk_score.estimated_delay_minutes} minutes
                    </Text>
                  )}
                  {weatherData.delay_risk_score.risk_factors.length > 0 && (
                    <View style={styles.riskFactors}>
                      <Text style={styles.riskFactorsTitle}>Risk Factors:</Text>
                      {weatherData.delay_risk_score.risk_factors.map((factor: string, idx: number) => (
                        <Text key={idx} style={styles.riskFactor}>• {factor}</Text>
                      ))}
                    </View>
                  )}
                </View>
              ) : (
                <Pressable style={styles.premiumCard} onPress={() => router.push("/premium")}>
                  <Text style={styles.premiumIcon}>🔒</Text>
                  <Text style={styles.premiumTitle}>Delay Risk Score</Text>
                  <Text style={styles.premiumDescription}>
                    Get AI-powered delay predictions based on weather conditions
                  </Text>
                  <View style={styles.premiumBtn}>
                    <Text style={styles.premiumBtnText}>Unlock with Pro</Text>
                  </View>
                </Pressable>
              )
            )}

            {/* Drive Window Advisor - PREMIUM */}
            {weatherData.drive_window_advice && (
              isPremium ? (
                <View style={[
                  styles.card,
                  styles.driveWindowCard,
                  weatherData.drive_window_advice.recommendation === 'postpone' && styles.driveWindowCardCritical,
                ]}>
                  <Text style={styles.sectionTitle}>⏰ Drive Window Advisor</Text>
                  <Text style={styles.driveWindowReason}>{weatherData.drive_window_advice.reason}</Text>
                  
                  {weatherData.drive_window_advice.optimal_departure_time && (
                    <View style={styles.driveWindowTime}>
                      <Text style={styles.driveWindowTimeLabel}>Recommended departure:</Text>
                      <Text style={styles.driveWindowTimeValue}>
                        {new Date(weatherData.drive_window_advice.optimal_departure_time).toLocaleString()}
                      </Text>
                    </View>
                  )}

                  {weatherData.drive_window_advice.time_shift_minutes !== 0 && (
                    <Text style={styles.driveWindowShift}>
                      {weatherData.drive_window_advice.time_shift_minutes > 0 ? '⏩' : '⏪'}{' '}
                      {Math.abs(weatherData.drive_window_advice.time_shift_minutes)} minutes{' '}
                      {weatherData.drive_window_advice.time_shift_minutes > 0 ? 'later' : 'earlier'}
                    </Text>
                  )}

                  {weatherData.drive_window_advice.alternate_route_available && (
                    <Text style={styles.driveWindowAlternate}>
                      🛣️ Alternate routes may be available
                    </Text>
                  )}
                </View>
              ) : (
                <Pressable style={styles.premiumCard} onPress={() => router.push("/premium")}>
                  <Text style={styles.premiumIcon}>🔒</Text>
                  <Text style={styles.premiumTitle}>Drive Window Advisor</Text>
                  <Text style={styles.premiumDescription}>
                    Get smart departure time recommendations to avoid bad weather
                  </Text>
                  <View style={styles.premiumBtn}>
                    <Text style={styles.premiumBtnText}>Unlock with Pro</Text>
                  </View>
                </Pressable>
              )
            )}

            {/* Severe Weather Alert */}
            {weatherData.has_severe_weather && (
              <View style={[styles.card, styles.alertCard]}>
                <Text style={styles.alertTitle}>⚠️ Severe Weather Alert</Text>
                <Text style={styles.alertText}>
                  Severe weather detected along your route. Check waypoints below for details.
                </Text>
              </View>
            )}

            {/* Bridge Clearance Warnings */}
            {weatherData.has_bridge_warnings && weatherData.bridge_clearances && weatherData.bridge_clearances.length > 0 && (
              <View style={[styles.card, styles.bridgeWarningCard]}>
                <Text style={styles.bridgeWarningTitle}>🚛 Low Bridge Warnings</Text>
                <Text style={styles.bridgeWarningSubtext}>
                  {weatherData.bridge_clearances.length} low clearance{weatherData.bridge_clearances.length > 1 ? 's' : ''} detected for your vehicle height
                </Text>
                {weatherData.bridge_clearances.map((bridge: any, idx: number) => {
                  const warningColor = bridge.warning_level === 'critical' ? '#ff4444' : 
                                      bridge.warning_level === 'warning' ? '#ff9944' : '#ffcc44';
                  return (
                    <View key={idx} style={[styles.bridgeItem, { borderLeftColor: warningColor }]}>
                      <Text style={styles.bridgeName}>
                        {bridge.name || `Bridge ${idx + 1}`}
                      </Text>
                      {bridge.distance_from_start != null && (
                        <Text style={styles.bridgeDistance}>
                          📍 {bridge.distance_from_start.toFixed(1)} miles from start
                        </Text>
                      )}
                      <Text style={styles.bridgeClearance}>
                        Clearance: {bridge.clearance_feet}' ({bridge.clearance_meters}m)
                      </Text>
                      {bridge.warning_level === 'critical' && (
                        <Text style={styles.bridgeCritical}>
                          ⛔ CRITICAL: Vehicle may not fit!
                        </Text>
                      )}
                      {bridge.warning_level === 'warning' && (
                        <Text style={styles.bridgeWarningText}>
                          ⚠️ Tight clearance - use caution
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Trip Stats */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>📊 Trip Overview</Text>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Duration:</Text>
                <Text style={styles.statValue}>
                  {Math.floor((weatherData.total_duration_minutes || 0) / 60)}h{" "}
                  {(weatherData.total_duration_minutes || 0) % 60}m
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Waypoints:</Text>
                <Text style={styles.statValue}>
                  {weatherData.waypoints?.length || 0} locations
                </Text>
              </View>
            </View>

            {/* Packing Suggestions */}
            {weatherData.packing_suggestions && Array.isArray(weatherData.packing_suggestions) && weatherData.packing_suggestions.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>🎒 Packing Suggestions</Text>
                {weatherData.packing_suggestions.map((item: any, idx: number) => {
                  let displayText = '';
                  if (typeof item === 'string') {
                    displayText = item;
                  } else if (item && typeof item === 'object') {
                    displayText = item.item || item.name || item.suggestion || String(item);
                  } else {
                    displayText = String(item);
                  }
                  
                  return (
                    <Text key={idx} style={styles.packingItem}>
                      • {displayText}
                    </Text>
                  );
                })}
              </View>
            )}

            {/* Waypoints Weather */}
            {weatherData.waypoints && Array.isArray(weatherData.waypoints) && weatherData.waypoints.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>🗺️ Weather Along Route</Text>
                {weatherData.waypoints.map((wp: any, idx: number) => {
                  if (!wp) return null;
                  
                  const waypointName = wp.waypoint?.name || `Point ${idx + 1}`;
                  const distance = wp.waypoint?.distance_from_start;
                  const weather = wp.weather;
                  const alerts = wp.alerts;
                  
                  return (
                    <View key={idx} style={styles.waypointCard}>
                      <Text style={styles.waypointName}>{waypointName}</Text>
                      
                      {distance != null && (
                        <Text style={styles.waypointDistance}>
                          {typeof distance === 'number' ? distance.toFixed(0) : distance} miles from start
                        </Text>
                      )}

                      {weather && (
                        <View style={styles.weatherInfo}>
                          {weather.temperature != null && (
                            <Text style={styles.weatherTemp}>
                              {weather.temperature}°{weather.temperature_unit || "F"}
                            </Text>
                          )}
                          {weather.conditions && (
                            <Text style={styles.weatherCondition}>
                              {String(weather.conditions)}
                            </Text>
                          )}
                          {weather.wind_speed && (
                            <Text style={styles.weatherWind}>
                              Wind: {String(weather.wind_speed)}
                            </Text>
                          )}
                        </View>
                      )}

                      {/* Weather Alerts */}
                      {alerts && Array.isArray(alerts) && alerts.length > 0 && (
                        <View style={styles.alertsContainer}>
                          <Text style={styles.alertsTitle}>⚠️ Active Alerts:</Text>
                          {alerts.map((alert: any, alertIdx: number) => {
                            if (!alert) return null;
                            return (
                              <View key={alertIdx} style={styles.alertItem}>
                                <Text style={styles.alertSeverity}>
                                  {String(alert.severity || "Alert")}
                                </Text>
                                <Text style={styles.alertEvent}>
                                  {String(alert.event || "Weather Alert")}
                                </Text>
                                {alert.headline && (
                                  <Text style={styles.alertHeadline} numberOfLines={2}>
                                    {String(alert.headline)}
                                  </Text>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.subText}>
              Preparing to fetch weather data...
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1220" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#16213a",
  },
  backText: { color: "#cfe3ff", fontWeight: "700" },
  title: { color: "white", fontSize: 18, fontWeight: "800" },
  container: { padding: 14, gap: 12 },
  card: {
    backgroundColor: "#121a2b",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#23304f",
  },
  label: { color: "#9fb5d6", fontWeight: "700", marginBottom: 6 },
  routeText: { color: "white", fontSize: 16, fontWeight: "800" },
  subText: { color: "#b8c7df", marginTop: 2 },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: "#f3c300",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { fontWeight: "900", color: "#121212" },
  center: { alignItems: "center", gap: 10, paddingVertical: 14 },
  errorTitle: { color: "#ffb4b4", fontWeight: "900", marginBottom: 6 },
  errorText: { color: "#ffd0d0" },
  
  // New styles for weather display
  sectionTitle: {
    color: "#f3c300",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  aiText: {
    color: "#d8e7ff",
    fontSize: 14,
    lineHeight: 20,
  },
  alertCard: {
    backgroundColor: "#2d1a1a",
    borderColor: "#ff6b6b",
  },
  alertTitle: {
    color: "#ff6b6b",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  alertText: {
    color: "#ffb4b4",
    fontSize: 14,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statLabel: {
    color: "#9fb5d6",
    fontSize: 14,
    fontWeight: "600",
  },
  statValue: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  packingItem: {
    color: "#d8e7ff",
    fontSize: 14,
    marginBottom: 6,
  },
  waypointCard: {
    backgroundColor: "#0f1621",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1a2740",
  },
  waypointName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  waypointDistance: {
    color: "#9fb5d6",
    fontSize: 12,
    marginBottom: 8,
  },
  weatherInfo: {
    backgroundColor: "#1a2740",
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  weatherTemp: {
    color: "#f3c300",
    fontSize: 24,
    fontWeight: "900",
  },
  weatherCondition: {
    color: "#d8e7ff",
    fontSize: 14,
    marginTop: 4,
  },
  weatherWind: {
    color: "#9fb5d6",
    fontSize: 12,
    marginTop: 4,
  },
  alertsContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#2d1a1a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ff6b6b",
  },
  alertsTitle: {
    color: "#ff6b6b",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 6,
  },
  alertItem: {
    marginBottom: 8,
  },
  alertSeverity: {
    color: "#ff6b6b",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  alertEvent: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
  alertHeadline: {
    color: "#ffb4b4",
    fontSize: 12,
    marginTop: 4,
  },

  // Bridge warning styles
  bridgeWarningCard: {
    backgroundColor: "#2a1a0f",
    borderColor: "#ff9944",
  },
  bridgeWarningTitle: {
    color: "#ff9944",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  bridgeWarningSubtext: {
    color: "#ffcc99",
    fontSize: 13,
    marginBottom: 12,
  },
  bridgeItem: {
    backgroundColor: "#1a1410",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderLeftWidth: 4,
  },
  bridgeName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  bridgeDistance: {
    color: "#ffcc99",
    fontSize: 12,
    marginBottom: 4,
  },
  bridgeClearance: {
    color: "#d8e7ff",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  bridgeCritical: {
    color: "#ff4444",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 6,
  },
  bridgeWarningText: {
    color: "#ff9944",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 6,
  },

  // Risk score styles
  riskCard: {
    backgroundColor: "#1a2b1a",
    borderColor: "#4ade80",
  },
  riskCardMedium: {
    backgroundColor: "#2b2b1a",
    borderColor: "#facc15",
  },
  riskCardHigh: {
    backgroundColor: "#2b1f1a",
    borderColor: "#ff9944",
  },
  riskCardCritical: {
    backgroundColor: "#2b1a1a",
    borderColor: "#ff4444",
  },
  riskScoreContainer: {
    alignItems: "center",
    marginVertical: 16,
  },
  riskPercent: {
    color: "#fff",
    fontSize: 48,
    fontWeight: "900",
  },
  riskLevel: {
    color: "#facc15",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 8,
  },
  riskDelay: {
    color: "#d8e7ff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
  },
  riskFactors: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  riskFactorsTitle: {
    color: "#9fb5d6",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
  },
  riskFactor: {
    color: "#d8e7ff",
    fontSize: 13,
    marginBottom: 4,
  },

  // Drive window advisor styles
  driveWindowCard: {
    backgroundColor: "#1a1f2b",
    borderColor: "#4ade80",
  },
  driveWindowCardCritical: {
    backgroundColor: "#2b1a1a",
    borderColor: "#ff4444",
  },
  driveWindowReason: {
    color: "#d8e7ff",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  driveWindowTime: {
    backgroundColor: "rgba(250,204,21,0.1)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  driveWindowTimeLabel: {
    color: "#9fb5d6",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  driveWindowTimeValue: {
    color: "#facc15",
    fontSize: 16,
    fontWeight: "900",
  },
  driveWindowShift: {
    color: "#4ade80",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
  driveWindowAlternate: {
    color: "#9fb5d6",
    fontSize: 13,
    textAlign: "center",
    marginTop: 12,
    fontStyle: "italic",
  },

  // Bridge warning styles
  bridgeWarning: {
    backgroundColor: "rgba(255,107,107,0.1)",
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
  },
  bridgeLocation: {
    color: "#ffb4b4",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  bridgeClearance: {
    color: "#ffd0d0",
    fontSize: 13,
    marginBottom: 4,
  },
  bridgeDanger: {
    color: "#ff6b6b",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 6,
  },
  bridgeMessage: {
    color: "#ffb4b4",
    fontSize: 12,
    marginTop: 4,
    fontStyle: "italic",
  },

  // Premium paywall styles
  premiumCard: {
    backgroundColor: "rgba(250,204,21,0.05)",
    borderRadius: 14,
    padding: 20,
    borderWidth: 2,
    borderColor: "#facc15",
    borderStyle: "dashed",
    alignItems: "center",
  },
  premiumIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  premiumTitle: {
    color: "#facc15",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },
  premiumDescription: {
    color: "#d8e7ff",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  premiumBtn: {
    backgroundColor: "#facc15",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  premiumBtnText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "900",
  },
});