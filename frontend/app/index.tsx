import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Switch,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * ✅ API base:
 * - Defaults to Render in production/internal-test installs
 * - EXPO_PUBLIC_BACKEND_URL overrides when present
 */
const API_BASE =
  process.env.EXPO_PUBLIC_BACKEND_URL || 'https://routecast-backend.onrender.com';

/**
 * ✅ Local persistent store (AsyncStorage)
 * This is the Expo-friendly equivalent of a local favorites.json file.
 */
const ROUTE_STORE_KEY = 'rc_route_store_v1';
const LAST_ROUTE_KEY = 'lastRoute';

interface StopPoint {
  location: string;
  type: 'stop' | 'gas' | 'food' | 'rest';
}

interface SavedRoute {
  id?: string;
  _id?: string;
  route_id?: string;
  origin: string;
  destination: string;
  stops?: StopPoint[];
  is_favorite?: boolean;
  created_at?: string;
}

type RouteStore = {
  favorites: SavedRoute[];
  recents: SavedRoute[];
};

/**
 * Backend responses sometimes return:
 * - an array
 * - { routes: [...] }
 * - { items: [...] }
 * - { data: [...] }
 */
function normalizeRoutes(data: any): SavedRoute[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.routes)) return data.routes;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getRouteId(route: SavedRoute): string {
  return route.id || route._id || route.route_id || '';
}

function norm(s: string) {
  return (s || '').trim().toLowerCase();
}

function sameRoute(a: SavedRoute, b: SavedRoute) {
  return norm(a.origin) === norm(b.origin) && norm(a.destination) === norm(b.destination);
}

async function readStore(): Promise<RouteStore> {
  try {
    const raw = await AsyncStorage.getItem(ROUTE_STORE_KEY);
    if (!raw) return { favorites: [], recents: [] };
    const parsed = JSON.parse(raw);
    return {
      favorites: Array.isArray(parsed?.favorites) ? parsed.favorites : [],
      recents: Array.isArray(parsed?.recents) ? parsed.recents : [],
    };
  } catch {
    return { favorites: [], recents: [] };
  }
}

async function writeStore(store: RouteStore) {
  try {
    await AsyncStorage.setItem(ROUTE_STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export default function HomeScreen() {
  /**
   * KeepAwake (safe):
   * - Only enable in __DEV__
   * - Cleanup on unmount
   */
  useEffect(() => {
    let isMounted = true;

    const enable = async () => {
      try {
        if (__DEV__ && isMounted) {
          await activateKeepAwakeAsync();
        }
      } catch (e) {
        console.log('KeepAwake failed:', e);
      }
    };

    enable();

    return () => {
      isMounted = false;
      try {
        if (__DEV__) deactivateKeepAwake();
      } catch {}
    };
  }, []);

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');

  const [loading, setLoading] = useState(false); // route weather request
  const [listLoading, setListLoading] = useState(false); // recent/favorites list
  const [error, setError] = useState('');

  const [alertsEnabled, setAlertsEnabled] = useState(false);

  const [recentRoutes, setRecentRoutes] = useState<SavedRoute[]>([]);
  const [favoriteRoutes, setFavoriteRoutes] = useState<SavedRoute[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Departure time
  const [departureTime, setDepartureTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [useCustomTime, setUseCustomTime] = useState(false);

  // Multi-stop
  const [stops, setStops] = useState<StopPoint[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopLocation, setNewStopLocation] = useState('');
  const [newStopType, setNewStopType] = useState<StopPoint['type']>('stop');

  const canSaveFavorite = useMemo(
    () => origin.trim().length > 0 && destination.trim().length > 0,
    [origin, destination]
  );

  const stopTypeIcons: Record<StopPoint['type'], any> = {
    stop: 'location-outline',
    gas: 'car-outline',
    food: 'restaurant-outline',
    rest: 'bed-outline',
  };

  const routesToShow = showFavorites ? favoriteRoutes : recentRoutes;

  const refreshFromLocal = useCallback(async () => {
    const store = await readStore();
    setRecentRoutes(store.recents);
    setFavoriteRoutes(store.favorites);
  }, []);

  useEffect(() => {
    // Local-first load
    void refreshFromLocal();

    // Best-effort remote sync (never wipes local with empty)
    void (async () => {
      await Promise.all([fetchRecentRoutesRemote(), fetchFavoriteRoutesRemote()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ✅ Critical for Expo Router:
   * When you go /route -> back, this screen often stays mounted.
   * So we refresh local store whenever Home regains focus.
   */
  useFocusEffect(
    useCallback(() => {
      void refreshFromLocal();
      return () => {};
    }, [refreshFromLocal])
  );

  const fetchRecentRoutesRemote = async () => {
    setListLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/api/routes/history`, { timeout: 30000 });
      const routes = normalizeRoutes(response.data);

      // ✅ Don't wipe local if backend returns empty
      if (routes.length > 0) {
        const top = routes.slice(0, 10);
        setRecentRoutes(top);

        const store = await readStore();
        await writeStore({ ...store, recents: top });
      }
    } catch (err: any) {
      console.log('Error fetching history (using local):', err?.message || err);
    } finally {
      setListLoading(false);
    }
  };

  const fetchFavoriteRoutesRemote = async () => {
    setListLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/api/routes/favorites`, { timeout: 30000 });
      const routes = normalizeRoutes(response.data);

      // ✅ Don't wipe local if backend returns empty
      if (routes.length > 0) {
        setFavoriteRoutes(routes);

        const store = await readStore();
        await writeStore({ ...store, favorites: routes });
      }
    } catch (err: any) {
      console.log('Error fetching favorites (using local):', err?.message || err);
    } finally {
      setListLoading(false);
    }
  };

  const upsertRecentLocal = async (route: SavedRoute) => {
    const store = await readStore();
    const deduped = [route, ...store.recents.filter((r) => !sameRoute(r, route))].slice(0, 10);
    await writeStore({ ...store, recents: deduped });
    setRecentRoutes(deduped);
  };

  const addFavoriteLocal = async (route: SavedRoute) => {
    const store = await readStore();
    const exists = store.favorites.some((r) => sameRoute(r, route));
    const favorites = exists ? store.favorites : [route, ...store.favorites];
    await writeStore({ ...store, favorites });
    setFavoriteRoutes(favorites);
  };

  const removeFavoriteLocal = async (route: SavedRoute) => {
    const store = await readStore();
    const favorites = store.favorites.filter((r) => !sameRoute(r, route));
    await writeStore({ ...store, favorites });
    setFavoriteRoutes(favorites);
  };

  const handleGetWeather = async () => {
    if (!origin.trim() || !destination.trim()) {
      setError('Please enter both origin and destination');
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    setError('');

    try {
      const requestData: any = {
        origin: origin.trim(),
        destination: destination.trim(),
        alerts_enabled: alertsEnabled,
      };

      if (Array.isArray(stops) && stops.length > 0) requestData.stops = stops;
      if (useCustomTime) requestData.departure_time = departureTime.toISOString();

      const response = await axios.post(`${API_BASE}/api/route/weather`, requestData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      // Cache last route payload (existing behavior)
      await AsyncStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(response.data));

      // ✅ Update local recents immediately (even if backend history is broken)
      await upsertRecentLocal({
        origin: origin.trim(),
        destination: destination.trim(),
        stops: Array.isArray(stops) ? stops : [],
        created_at: new Date().toISOString(),
      });

      router.push({
        pathname: '/route',
        params: { routeData: JSON.stringify(response.data) },
      });
    } catch (err: any) {
      console.error('Error:', err);

      const apiDetail =
        err?.response?.data?.detail || err?.response?.data?.message || err?.message;

      setError(apiDetail || 'Failed to get weather data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRoute = (route: SavedRoute) => {
    setOrigin(route.origin || '');
    setDestination(route.destination || '');
    setStops(Array.isArray(route.stops) ? route.stops : []);
    setError('');
    Keyboard.dismiss();
  };

  const addToFavorites = async () => {
    if (!origin.trim() || !destination.trim()) {
      setError('Enter a route first to save as favorite');
      return;
    }
    if (!canSaveFavorite) return;

    setError('');
    setSaveMessage('');

    const fav: SavedRoute = {
      origin: origin.trim(),
      destination: destination.trim(),
      stops: Array.isArray(stops) ? stops : [],
      is_favorite: true,
      created_at: new Date().toISOString(),
    };

    // ✅ Always save locally (instant UI update)
    await addFavoriteLocal(fav);
    setSaveMessage('Saved to favorites');
    setShowFavorites(true);

    // Best-effort remote save (won't break local if it fails)
    try {
      await axios.post(
        `${API_BASE}/api/routes/favorites`,
        {
          origin: fav.origin,
          destination: fav.destination,
          stops: fav.stops || [],
          name: `${fav.origin} to ${fav.destination}`,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );

      // Optional: refresh remote in case backend adds IDs
      void fetchFavoriteRoutesRemote();
    } catch (err: any) {
      console.log('Remote favorite save failed (kept local):', err?.message || err);
    }
  };

  const removeFavorite = async (route: SavedRoute) => {
    setError('');
    setSaveMessage('');

    // ✅ Always remove locally
    await removeFavoriteLocal(route);
    setSaveMessage('Removed from favorites');

    // Best-effort remote remove if we have an ID
    const id = getRouteId(route);
    if (!id) return;

    try {
      await axios.delete(`${API_BASE}/api/routes/favorites/${id}`, { timeout: 30000 });
      void fetchFavoriteRoutesRemote();
    } catch (err: any) {
      console.log('Remote favorite remove failed (kept local removal):', err?.message || err);
    }
  };

  const addStop = () => {
    const loc = newStopLocation.trim();
    if (!loc) return;

    setStops((prev) => [...prev, { location: loc, type: newStopType }]);
    setNewStopLocation('');
    setNewStopType('stop');
    setShowAddStop(false);
  };

  const removeStop = (index: number) => {
    setStops((prev) => prev.filter((_, i) => i !== index));
  };

  const swapLocations = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  return (
    <View style={styles.container}>
      <View style={styles.mapBackground}>
        <View style={styles.mapOverlay} />
      </View>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.mainCard}>
              <View style={styles.header}>
                <View style={styles.iconContainer}>
                  <MaterialCommunityIcons name="routes" size={28} color="#1a1a1a" />
                </View>

                <View style={styles.headerText}>
                  <Text style={styles.title}>Routecast</Text>
                  <Text style={styles.subtitle}>Weather forecasts for your journey</Text>
                </View>

                <TouchableOpacity style={styles.favoriteButton} onPress={addToFavorites}>
                  <Ionicons name="heart-outline" size={24} color="#eab308" />
                </TouchableOpacity>
              </View>

              <View style={styles.descriptionBox}>
                <Text style={styles.descriptionText}>
                  Plan your road trip with confidence. See real-time weather conditions, alerts,
                  and AI-powered recommendations for every mile of your drive.
                </Text>
              </View>

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>ORIGIN</Text>
                <View style={styles.inputWrapper}>
                  <View style={styles.originIcon}>
                    <Ionicons name="location" size={20} color="#22c55e" />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter starting location"
                    placeholderTextColor="#6b7280"
                    value={origin}
                    onChangeText={setOrigin}
                    returnKeyType="next"
                  />
                </View>
              </View>

              {stops.length > 0 && (
                <View style={styles.stopsContainer}>
                  {stops.map((stop, index) => (
                    <View key={`${stop.location}-${index}`} style={styles.stopItem}>
                      <Ionicons name={stopTypeIcons[stop.type]} size={16} color="#f59e0b" />
                      <Text style={styles.stopText} numberOfLines={1}>
                        {stop.location}
                      </Text>
                      <TouchableOpacity onPress={() => removeStop(index)}>
                        <Ionicons name="close-circle" size={18} color="#6b7280" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity style={styles.addStopButton} onPress={() => setShowAddStop(true)}>
                <Ionicons name="add-circle-outline" size={18} color="#60a5fa" />
                <Text style={styles.addStopText}>Add Stop</Text>
              </TouchableOpacity>

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>DESTINATION</Text>
                <View style={styles.inputWrapper}>
                  <View style={styles.destinationIcon}>
                    <Ionicons name="navigate" size={20} color="#ef4444" />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter destination"
                    placeholderTextColor="#6b7280"
                    value={destination}
                    onChangeText={setDestination}
                    returnKeyType="done"
                    onSubmitEditing={handleGetWeather}
                  />
                  <TouchableOpacity onPress={swapLocations} style={styles.swapButton}>
                    <Ionicons name="swap-vertical" size={20} color="#60a5fa" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.departureSection}>
                <View style={styles.departureToggle}>
                  <Ionicons name="time-outline" size={20} color="#a1a1aa" />
                  <Text style={styles.departureLabel}>Custom Departure Time</Text>
                  <Switch
                    value={useCustomTime}
                    onValueChange={setUseCustomTime}
                    trackColor={{ false: '#3f3f46', true: '#eab30880' }}
                    thumbColor={useCustomTime ? '#eab308' : '#71717a'}
                  />
                </View>

                {useCustomTime && (
                  <TouchableOpacity style={styles.timeButton} onPress={() => setShowDatePicker(true)}>
                    <Text style={styles.timeButtonText}>
                      {format(departureTime, 'MMM d, h:mm a')}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color="#6b7280" />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.alertsToggle}>
                <View style={styles.alertsLeft}>
                  <Ionicons name="notifications-outline" size={22} color="#eab308" />
                  <Text style={styles.alertsText}>Push Weather Alerts</Text>
                </View>
                <Switch
                  value={alertsEnabled}
                  onValueChange={setAlertsEnabled}
                  trackColor={{ false: '#3f3f46', true: '#eab30880' }}
                  thumbColor={alertsEnabled ? '#eab308' : '#71717a'}
                />
              </View>

              {error ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={18} color="#ef4444" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {saveMessage ? (
                <View style={styles.saveContainer}>
                  <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  <Text style={styles.saveText}>{saveMessage}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleGetWeather}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#1a1a1a" size="small" />
                ) : (
                  <>
                    <Ionicons name="navigate" size={22} color="#1a1a1a" />
                    <Text style={styles.buttonText}>CHECK ROUTE WEATHER</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.tabsContainer}>
              <TouchableOpacity
                style={[styles.tab, !showFavorites && styles.tabActive]}
                onPress={() => {
                  setShowFavorites(false);
                  void refreshFromLocal();
                  void fetchRecentRoutesRemote();
                }}
              >
                <Ionicons
                  name="time-outline"
                  size={18}
                  color={!showFavorites ? '#eab308' : '#6b7280'}
                />
                <Text style={[styles.tabText, !showFavorites && styles.tabTextActive]}>Recent</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tab, showFavorites && styles.tabActive]}
                onPress={() => {
                  setShowFavorites(true);
                  void refreshFromLocal();
                  void fetchFavoriteRoutesRemote();
                }}
              >
                <Ionicons name="heart" size={18} color={showFavorites ? '#eab308' : '#6b7280'} />
                <Text style={[styles.tabText, showFavorites && styles.tabTextActive]}>
                  Favorites
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.routesSection}>
              {listLoading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator />
                  <Text style={[styles.emptyText, { marginTop: 10 }]}>Loading…</Text>
                </View>
              ) : routesToShow.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons
                    name={showFavorites ? 'heart-outline' : 'map-outline'}
                    size={48}
                    color="#374151"
                  />
                  <Text style={styles.emptyText}>
                    {showFavorites ? 'No favorite routes' : 'No recent routes'}
                  </Text>
                </View>
              ) : (
                routesToShow.map((route, idx) => {
                  const id = getRouteId(route) || `${route.origin}-${route.destination}-${idx}`;

                  return (
                    <View key={id} style={styles.routeCard}>
                      <Pressable style={styles.routePress} onPress={() => handleSelectRoute(route)}>
                        <View style={styles.routeInfo}>
                          <View style={styles.routeLocations}>
                            <View style={styles.routeLocation}>
                              <View style={styles.routeDot} />
                              <Text style={styles.routeText} numberOfLines={1}>
                                {route.origin}
                              </Text>
                            </View>

                            {route.stops && route.stops.length > 0 ? (
                              <View style={styles.routeStops}>
                                <Text style={styles.routeStopsText}>
                                  +{route.stops.length} stop{route.stops.length > 1 ? 's' : ''}
                                </Text>
                              </View>
                            ) : null}

                            <View style={styles.routeLocation}>
                              <View style={[styles.routeDot, styles.routeDotEnd]} />
                              <Text style={styles.routeText} numberOfLines={1}>
                                {route.destination}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </Pressable>

                      {showFavorites ? (
                        <Pressable onPress={() => removeFavorite(route)} hitSlop={10}>
                          <Ionicons name="heart-dislike" size={20} color="#ef4444" />
                        </Pressable>
                      ) : (
                        <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {showDatePicker && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Departure Time</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              <DateTimePicker
                value={departureTime}
                mode="datetime"
                display="spinner"
                onChange={(_, date) => {
                  if (date) setDepartureTime(date);
                }}
                // @ts-expect-error - Android ignores textColor; iOS supports it
                textColor="#fff"
                minimumDate={new Date()}
              />

              <TouchableOpacity style={styles.modalButton} onPress={() => setShowDatePicker(false)}>
                <Text style={styles.modalButtonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {showAddStop && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowAddStop(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Stop</Text>
                <TouchableOpacity onPress={() => setShowAddStop(false)}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.modalInput}
                placeholder="Enter stop location"
                placeholderTextColor="#6b7280"
                value={newStopLocation}
                onChangeText={setNewStopLocation}
              />

              <Text style={styles.stopTypeLabel}>Stop Type</Text>

              <View style={styles.stopTypes}>
                {[
                  { type: 'stop' as const, label: 'Stop', icon: 'location-outline' as const },
                  { type: 'gas' as const, label: 'Gas', icon: 'car-outline' as const },
                  { type: 'food' as const, label: 'Food', icon: 'restaurant-outline' as const },
                  { type: 'rest' as const, label: 'Rest', icon: 'bed-outline' as const },
                ].map((item) => (
                  <TouchableOpacity
                    key={item.type}
                    style={[
                      styles.stopTypeButton,
                      newStopType === item.type && styles.stopTypeButtonActive,
                    ]}
                    onPress={() => setNewStopType(item.type)}
                  >
                    <Ionicons
                      name={item.icon}
                      size={20}
                      color={newStopType === item.type ? '#eab308' : '#6b7280'}
                    />
                    <Text
                      style={[
                        styles.stopTypeText,
                        newStopType === item.type && styles.stopTypeTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.modalButton} onPress={addStop}>
                <Text style={styles.modalButtonText}>Add Stop</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },

  mapBackground: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1a1a1a' },
  mapOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.7)' },

  safeArea: { flex: 1 },
  keyboardView: { flex: 1 },

  scrollContent: {
    padding: 16,
    paddingTop: 12,
    paddingBottom: 40,
    flexGrow: 1,
  },

  mainCard: {
    backgroundColor: '#27272a',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#eab308',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  headerText: { flex: 1 },

  title: { fontSize: 22, fontWeight: '700', color: '#ffffff', marginBottom: 2 },
  subtitle: { fontSize: 13, color: '#a1a1aa' },

  favoriteButton: { padding: 8 },

  descriptionBox: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#eab308',
  },

  descriptionText: { color: '#d4d4d8', fontSize: 12, lineHeight: 18 },

  inputSection: { marginBottom: 12 },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#a1a1aa',
    letterSpacing: 1,
    marginBottom: 6,
  },

  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3f3f46',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#52525b',
    paddingHorizontal: 12,
  },

  originIcon: { marginRight: 10 },
  destinationIcon: { marginRight: 10 },

  input: {
    flex: 1,
    fontSize: 15,
    color: '#ffffff',
    paddingVertical: 12,
    fontWeight: '500',
  },

  swapButton: { padding: 8 },

  stopsContainer: { marginBottom: 8 },

  stopItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3f3f46',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
    gap: 8,
  },

  stopText: { flex: 1, color: '#e4e4e7', fontSize: 14 },

  addStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingVertical: 4,
  },

  addStopText: { color: '#60a5fa', fontSize: 13, fontWeight: '500' },

  departureSection: { marginBottom: 12 },
  departureToggle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  departureLabel: { flex: 1, color: '#e4e4e7', fontSize: 14 },

  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#3f3f46',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },

  timeButtonText: { color: '#eab308', fontSize: 14, fontWeight: '500' },

  alertsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 12,
  },

  alertsLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertsText: { fontSize: 14, fontWeight: '600', color: '#ffffff' },

  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },

  errorText: { color: '#ef4444', fontSize: 13, flex: 1 },

  saveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },

  saveText: { color: '#22c55e', fontSize: 13, flex: 1, fontWeight: '600' },

  button: {
    backgroundColor: '#eab308',
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },

  buttonDisabled: { opacity: 0.7 },

  buttonText: {
    color: '#1a1a1a',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  tabsContainer: { flexDirection: 'row', marginBottom: 12, gap: 8 },

  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#27272a',
    borderRadius: 10,
  },

  tabActive: { backgroundColor: '#3f3f46' },

  tabText: { color: '#6b7280', fontSize: 14, fontWeight: '500' },
  tabTextActive: { color: '#eab308' },

  routesSection: { minHeight: 100 },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#27272a',
    borderRadius: 12,
  },

  emptyText: { color: '#6b7280', fontSize: 14, marginTop: 12 },

  routeCard: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  routePress: { flex: 1 },

  routeInfo: { flex: 1 },

  routeLocations: { gap: 2 },

  routeLocation: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  routeDotEnd: { backgroundColor: '#ef4444' },

  routeText: { color: '#e4e4e7', fontSize: 13, flex: 1 },

  routeStops: { marginLeft: 16, paddingVertical: 2 },
  routeStopsText: { color: '#f59e0b', fontSize: 11 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },

  modalContent: {
    backgroundColor: '#27272a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },

  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },

  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },

  modalInput: {
    backgroundColor: '#3f3f46',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#fff',
    marginBottom: 16,
  },

  stopTypeLabel: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    letterSpacing: 0.5,
  },

  stopTypes: { flexDirection: 'row', gap: 10, marginBottom: 20 },

  stopTypeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#3f3f46',
    borderRadius: 10,
    gap: 4,
  },

  stopTypeButtonActive: {
    backgroundColor: '#52525b',
    borderWidth: 1,
    borderColor: '#eab308',
  },

  stopTypeText: { color: '#6b7280', fontSize: 11 },
  stopTypeTextActive: { color: '#eab308' },

  modalButton: {
    backgroundColor: '#eab308',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalButtonText: { color: '#1a1a1a', fontSize: 15, fontWeight: '700' },
});