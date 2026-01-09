import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
  FlatList,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import axios from "axios";

type StopPoint = { location: string; type: string };

type SavedRoute = {
  id: string;
  origin: string;
  destination: string;
  stops: StopPoint[];
  createdAt: string;
  isFavorite?: boolean;
  favoriteName?: string;
};

const RECENTS_KEY = "routecast_recents_v1";
const FAVORITES_KEY = "routecast_favorites_v1";

function nowISO() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function uniqById<T extends { id: string }>(arr: T[]) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function normalizeSavedRoutes(raw: unknown): SavedRoute[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedRoute[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Partial<SavedRoute>;

    const origin = typeof r.origin === "string" ? r.origin : "";
    const destination = typeof r.destination === "string" ? r.destination : "";
    const stops: StopPoint[] = Array.isArray((r as any).stops)
      ? (r as any).stops
          .filter((s: any) => s && typeof s === "object")
          .map((s: any) => ({
            location: typeof s.location === "string" ? s.location : "",
            type: typeof s.type === "string" ? s.type : "stop",
          }))
      : [];

    let id = typeof r.id === "string" ? r.id : "";
    if (!id || seen.has(id)) id = makeId();
    seen.add(id);

    out.push({
      id,
      origin,
      destination,
      stops,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : nowISO(),
      isFavorite: typeof r.isFavorite === "boolean" ? r.isFavorite : undefined,
      favoriteName: typeof r.favoriteName === "string" ? r.favoriteName : undefined,
    });
  }

  return out;
}

type PlaceSuggestion = {
  id: string;
  place_name: string;
  text: string;
};

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "";

export default function IndexScreen() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [stops, setStops] = useState<StopPoint[]>([]);
  const [useCustomDeparture, setUseCustomDeparture] = useState(false);
  const [departure, setDeparture] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pushAlerts, setPushAlerts] = useState(false);
  
  // Vehicle height state
  const [checkBridges, setCheckBridges] = useState(false);
  const [vehicleHeight, setVehicleHeight] = useState("");
  const [vehicleHeightUnit, setVehicleHeightUnit] = useState<"feet" | "meters">("feet");

  const [activeTab, setActiveTab] = useState<"recent" | "favorites">("recent");
  const [recents, setRecents] = useState<SavedRoute[]>([]);
  const [favorites, setFavorites] = useState<SavedRoute[]>([]);

  // Autocomplete state
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<PlaceSuggestion[]>([]);
  const [stopSuggestions, setStopSuggestions] = useState<{ [key: number]: PlaceSuggestion[] }>({});
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestSuggestions, setShowDestSuggestions] = useState(false);
  const [showStopSuggestions, setShowStopSuggestions] = useState<{ [key: number]: boolean }>({});
  const [isLoadingOrigin, setIsLoadingOrigin] = useState(false);
  const [isLoadingDest, setIsLoadingDest] = useState(false);
  const [isLoadingStop, setIsLoadingStop] = useState<{ [key: number]: boolean }>({});
  
  const originDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const destDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const stopDebounceRefs = useRef<{ [key: number]: NodeJS.Timeout | null }>({});

  const fetchPlaceSuggestions = useCallback(async (query: string): Promise<PlaceSuggestion[]> => {
    if (!query || query.length < 3) return [];
    
    try {
      const response = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
        {
          params: {
            access_token: MAPBOX_TOKEN,
            country: "US",
            types: "place,locality,postcode",
            limit: 5,
          },
          timeout: 5000,
        }
      );

      if (response.data?.features) {
        return response.data.features.map((feature: any) => ({
          id: feature.id,
          place_name: feature.place_name,
          text: feature.text,
        }));
      }
      return [];
    } catch (error) {
      console.error("Error fetching place suggestions:", error);
      return [];
    }
  }, []);

  const handleOriginChange = useCallback((text: string) => {
    setOrigin(text);
    setShowOriginSuggestions(true);

    if (originDebounceRef.current) {
      clearTimeout(originDebounceRef.current);
    }

    if (text.length >= 3) {
      setIsLoadingOrigin(true);
      originDebounceRef.current = setTimeout(async () => {
        const suggestions = await fetchPlaceSuggestions(text);
        setOriginSuggestions(suggestions);
        setIsLoadingOrigin(false);
      }, 300);
    } else {
      setOriginSuggestions([]);
      setIsLoadingOrigin(false);
    }
  }, [fetchPlaceSuggestions]);

  const handleDestChange = useCallback((text: string) => {
    setDestination(text);
    setShowDestSuggestions(true);

    if (destDebounceRef.current) {
      clearTimeout(destDebounceRef.current);
    }

    if (text.length >= 3) {
      setIsLoadingDest(true);
      destDebounceRef.current = setTimeout(async () => {
        const suggestions = await fetchPlaceSuggestions(text);
        setDestSuggestions(suggestions);
        setIsLoadingDest(false);
      }, 300);
    } else {
      setDestSuggestions([]);
      setIsLoadingDest(false);
    }
  }, [fetchPlaceSuggestions]);

  const handleStopChange = useCallback((idx: number, text: string) => {
    updateStop(idx, { location: text });
    setShowStopSuggestions(prev => ({ ...prev, [idx]: true }));

    if (stopDebounceRefs.current[idx]) {
      clearTimeout(stopDebounceRefs.current[idx]!);
    }

    if (text.length >= 3) {
      setIsLoadingStop(prev => ({ ...prev, [idx]: true }));
      stopDebounceRefs.current[idx] = setTimeout(async () => {
        const suggestions = await fetchPlaceSuggestions(text);
        setStopSuggestions(prev => ({ ...prev, [idx]: suggestions }));
        setIsLoadingStop(prev => ({ ...prev, [idx]: false }));
      }, 300);
    } else {
      setStopSuggestions(prev => ({ ...prev, [idx]: [] }));
      setIsLoadingStop(prev => ({ ...prev, [idx]: false }));
    }
  }, [fetchPlaceSuggestions]);

  const selectOriginSuggestion = useCallback((suggestion: PlaceSuggestion) => {
    setOrigin(suggestion.place_name);
    setShowOriginSuggestions(false);
    setOriginSuggestions([]);
  }, []);

  const selectDestSuggestion = useCallback((suggestion: PlaceSuggestion) => {
    setDestination(suggestion.place_name);
    setShowDestSuggestions(false);
    setDestSuggestions([]);
  }, []);

  const selectStopSuggestion = useCallback((idx: number, suggestion: PlaceSuggestion) => {
    updateStop(idx, { location: suggestion.place_name });
    setShowStopSuggestions(prev => ({ ...prev, [idx]: false }));
    setStopSuggestions(prev => ({ ...prev, [idx]: [] }));
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [rRaw, fRaw] = await Promise.all([
        AsyncStorage.getItem(RECENTS_KEY),
        AsyncStorage.getItem(FAVORITES_KEY),
      ]);
      const rParsed = rRaw ? JSON.parse(rRaw) : [];
      const fParsed = fRaw ? JSON.parse(fRaw) : [];

      const r = normalizeSavedRoutes(rParsed);
      const f = normalizeSavedRoutes(fParsed);

      // Persist normalized data (fixes missing/duplicate ids from older app versions)
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(r));
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(f));

      setRecents(r);
      setFavorites(f);
    } catch {
      setRecents([]);
      setFavorites([]);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const saveRecents = useCallback(async (next: SavedRoute[]) => {
    setRecents(next);
    try {
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const saveFavorites = useCallback(async (next: SavedRoute[]) => {
    setFavorites(next);
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const buildDraft = useCallback((): SavedRoute => {
    const o = origin.trim();
    const d = destination.trim();

    const cleanedStops = stops
      .map((s) => ({
        location: (s.location || "").trim(),
        type: (s.type || "stop").trim() || "stop",
      }))
      .filter((s) => s.location.length > 0);

    return {
      id: makeId(),
      origin: o,
      destination: d,
      stops: cleanedStops,
      createdAt: nowISO(),
    };
  }, [origin, destination, stops]);

  const onAddStop = useCallback(() => {
    setStops((prev) => [...prev, { location: "", type: "stop" }]);
  }, []);

  const updateStop = useCallback((idx: number, patch: Partial<StopPoint>) => {
    setStops((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  }, []);

  const removeStop = useCallback((idx: number) => {
    setStops((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const onLoadRouteIntoInputs = useCallback((r: SavedRoute) => {
    setOrigin(r.origin);
    setDestination(r.destination);
    setStops(Array.isArray(r.stops) ? r.stops : []);
  }, []);

  const onCheckRoute = useCallback(async () => {
    Keyboard.dismiss();

    const o = origin.trim();
    const d = destination.trim();
    if (!o || !d) {
      Alert.alert("Missing info", "Enter an origin and destination.");
      return;
    }

    const draft = buildDraft();

    // Save to recents (top 10)
    const nextRecents = uniqById([draft, ...recents]).slice(0, 10);
    await saveRecents(nextRecents);

    router.push({
      pathname: "/route",
      params: {
        origin: draft.origin,
        destination: draft.destination,
        stops: JSON.stringify(draft.stops || []),
        departure: useCustomDeparture && departure ? departure.toISOString() : "",
        pushAlerts: pushAlerts ? "1" : "0",
        checkBridges: checkBridges ? "1" : "0",
        vehicleHeight: checkBridges && vehicleHeight ? vehicleHeight : "",
        vehicleHeightUnit: vehicleHeightUnit,
      },
    });
  }, [
    origin,
    destination,
    buildDraft,
    recents,
    saveRecents,
    useCustomDeparture,
    departure,
    pushAlerts,
  ]);

  const onToggleFavoriteCurrent = useCallback(async () => {
    const o = origin.trim();
    const d = destination.trim();
    if (!o || !d) {
      Alert.alert("Missing info", "Enter an origin and destination first.");
      return;
    }

    // Stable “signature” so tapping heart toggles same route
    const signatureId = `${o}__${d}__${(stops || [])
      .map((s) => (s.location || "").trim())
      .filter(Boolean)
      .join("|")}`;

    const exists = favorites.some((f) => f.id === signatureId);

    if (exists) {
      const next = favorites.filter((f) => f.id !== signatureId);
      await saveFavorites(next);
      return;
    }

    const newFav: SavedRoute = {
      id: signatureId,
      origin: o,
      destination: d,
      stops: (stops || [])
        .map((s) => ({
          location: (s.location || "").trim(),
          type: (s.type || "stop").trim() || "stop",
        }))
        .filter((s) => s.location.length > 0),
      createdAt: nowISO(),
      isFavorite: true,
    };

    const next = uniqById([newFav, ...favorites]).slice(0, 25);
    await saveFavorites(next);
  }, [origin, destination, stops, favorites, saveFavorites]);

  const onClearInputs = useCallback(() => {
    setOrigin("");
    setDestination("");
    setStops([]);
    setUseCustomDeparture(false);
    setDeparture(null);
    setPushAlerts(false);
    setCheckBridges(false);
    setVehicleHeight("");
    setVehicleHeightUnit("feet");
  }, []);

  const listData = activeTab === "recent" ? recents : favorites;
  const hasList = listData.length > 0;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>Routecast</Text>
            <Text style={styles.subtitle}>Weather forecasts for your journey</Text>
          </View>

          <Pressable 
            onPress={() => router.push("/premium")} 
            style={styles.proBtn}
          >
            <Text style={styles.proBtnText}>⚡ PRO</Text>
          </Pressable>

          <Pressable onPress={onToggleFavoriteCurrent} style={styles.heartBtn}>
            <Text style={styles.heartText}>♥</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>ORIGIN</Text>
          <View>
            <TextInput
              value={origin}
              onChangeText={handleOriginChange}
              onFocus={() => setShowOriginSuggestions(true)}
              placeholder="Enter starting city, state"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
            {isLoadingOrigin && (
              <View style={styles.loadingIndicator}>
                <ActivityIndicator size="small" color="#facc15" />
              </View>
            )}
            {showOriginSuggestions && originSuggestions.length > 0 && (
              <View style={styles.suggestionsContainer}>
                {originSuggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion.id}
                    style={styles.suggestionItem}
                    onPress={() => selectOriginSuggestion(suggestion)}
                  >
                    <Text style={styles.suggestionText}>{suggestion.place_name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <Pressable onPress={onAddStop} style={styles.addStopBtn}>
            <Text style={styles.addStopText}>＋ Add Stop</Text>
          </Pressable>

          {stops.length > 0 && (
            <View style={{ marginTop: 10, gap: 10 }}>
              {stops.map((s, idx) => (
                <View key={`${idx}-${s.location}`} style={styles.stopRow}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={s.location}
                      onChangeText={(t) => handleStopChange(idx, t)}
                      onFocus={() => setShowStopSuggestions(prev => ({ ...prev, [idx]: true }))}
                      placeholder={`Stop ${idx + 1}`}
                      placeholderTextColor="rgba(255,255,255,0.35)"
                      style={[styles.input, { flex: 1, marginTop: 0 }]}
                    />
                    {isLoadingStop[idx] && (
                      <View style={[styles.loadingIndicator, { right: 50 }]}>
                        <ActivityIndicator size="small" color="#facc15" />
                      </View>
                    )}
                    {showStopSuggestions[idx] && stopSuggestions[idx] && stopSuggestions[idx].length > 0 && (
                      <View style={styles.suggestionsContainer}>
                        {stopSuggestions[idx].map((suggestion) => (
                          <Pressable
                            key={suggestion.id}
                            style={styles.suggestionItem}
                            onPress={() => selectStopSuggestion(idx, suggestion)}
                          >
                            <Text style={styles.suggestionText}>{suggestion.place_name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                  <Pressable
                    onPress={() => removeStop(idx)}
                    style={styles.stopRemove}
                  >
                    <Text style={styles.stopRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Text style={[styles.label, { marginTop: 14 }]}>DESTINATION</Text>
          <View>
            <TextInput
              value={destination}
              onChangeText={handleDestChange}
              onFocus={() => setShowDestSuggestions(true)}
              placeholder="Enter destination city, state"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
            {isLoadingDest && (
              <View style={styles.loadingIndicator}>
                <ActivityIndicator size="small" color="#facc15" />
              </View>
            )}
            {showDestSuggestions && destSuggestions.length > 0 && (
              <View style={styles.suggestionsContainer}>
                {destSuggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion.id}
                    style={styles.suggestionItem}
                    onPress={() => selectDestSuggestion(suggestion)}
                  >
                    <Text style={styles.suggestionText}>{suggestion.place_name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>Custom Departure Time</Text>
            <Switch
              value={useCustomDeparture}
              onValueChange={(v) => {
                setUseCustomDeparture(v);
                if (v) setShowPicker(true);
                if (!v) setDeparture(null);
              }}
            />
          </View>

          {useCustomDeparture && (
            <Pressable
              onPress={() => setShowPicker(true)}
              style={styles.departureChip}
            >
              <Text style={styles.departureChipText}>
                {departure ? departure.toLocaleString() : "Select departure time"}
              </Text>
            </Pressable>
          )}

          {showPicker && useCustomDeparture && (
            <DateTimePicker
              value={departure ?? new Date()}
              mode="datetime"
              onChange={(_, d) => {
                setShowPicker(false);
                if (d) setDeparture(d);
              }}
            />
          )}

          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>Push Weather Alerts</Text>
            <Switch value={pushAlerts} onValueChange={setPushAlerts} />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>🚛 Check Bridge Clearances</Text>
            <Switch 
              value={checkBridges} 
              onValueChange={(v) => {
                setCheckBridges(v);
                if (!v) {
                  setVehicleHeight("");
                }
              }} 
            />
          </View>

          {checkBridges && (
            <View style={styles.vehicleHeightContainer}>
              <Text style={styles.label}>VEHICLE HEIGHT</Text>
              <View style={styles.heightInputRow}>
                <TextInput
                  value={vehicleHeight}
                  onChangeText={setVehicleHeight}
                  placeholder="e.g., 13.6"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  keyboardType="decimal-pad"
                  style={[styles.input, { flex: 1, marginTop: 8 }]}
                />
                <View style={styles.unitToggle}>
                  <Pressable
                    style={[
                      styles.unitButton,
                      vehicleHeightUnit === "feet" && styles.unitButtonActive
                    ]}
                    onPress={() => setVehicleHeightUnit("feet")}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      vehicleHeightUnit === "feet" && styles.unitButtonTextActive
                    ]}>
                      Feet
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.unitButton,
                      vehicleHeightUnit === "meters" && styles.unitButtonActive
                    ]}
                    onPress={() => setVehicleHeightUnit("meters")}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      vehicleHeightUnit === "meters" && styles.unitButtonTextActive
                    ]}>
                      Meters
                    </Text>
                  </Pressable>
                </View>
              </View>
              <Text style={styles.helperText}>
                💡 Standard RV: 10-13.5 ft • Semi-truck: 13.5-14 ft
              </Text>
            </View>
          )}

          <Pressable style={styles.primaryBtn} onPress={onCheckRoute}>
            <Text style={styles.primaryText}>CHECK ROUTE WEATHER</Text>
          </Pressable>

          <Pressable onPress={onClearInputs} style={styles.clearBtn}>
            <Text style={styles.clearText}>Clear Inputs</Text>
          </Pressable>
        </View>

        <View style={{ height: 14 }} />

        <View style={styles.tabRow}>
          <Pressable
            onPress={() => setActiveTab("recent")}
            style={[styles.tab, activeTab === "recent" && styles.tabActive]}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "recent" && styles.tabTextActive,
              ]}
            >
              Recent
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab("favorites")}
            style={[styles.tab, activeTab === "favorites" && styles.tabActive]}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "favorites" && styles.tabTextActive,
              ]}
            >
              Favorites
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          {!hasList ? (
            <Text style={styles.muted}>
              {activeTab === "recent" ? "No recent routes" : "No favorites yet"}
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {listData.map((r, idx) => (
                // ✅ KEY FIX: ensure each row has a unique, stable key
                <Pressable
                  key={r.id || `${r.origin}→${r.destination}#${idx}`}
                  onPress={() => onLoadRouteIntoInputs(r)}
                  style={styles.rowItem}
                >
                  <Text style={styles.rowText} numberOfLines={1}>
                    {r.origin} → {r.destination}
                  </Text>
                  {Array.isArray(r.stops) && r.stops.length > 0 ? (
                    <Text style={styles.rowHint} numberOfLines={1}>
                      Stops: {r.stops.map((s) => s.location).join(" • ")}
                    </Text>
                  ) : (
                    <Text style={styles.rowHint}>Tap to load</Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}

          {hasList && (
            <Pressable
              onPress={async () => {
                if (activeTab === "recent") {
                  await AsyncStorage.removeItem(RECENTS_KEY);
                  setRecents([]);
                } else {
                  await AsyncStorage.removeItem(FAVORITES_KEY);
                  setFavorites([]);
                }
              }}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryText}>
                Clear {activeTab === "recent" ? "recents" : "favorites"}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1320" },
  content: { padding: 16, paddingTop: 26 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  brand: { color: "#facc15", fontSize: 26, fontWeight: "900" },
  subtitle: { color: "rgba(255,255,255,0.75)", marginTop: 6 },

  proBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#facc15",
    marginRight: 8,
  },
  proBtnText: {
    color: "#0a0a0a",
    fontSize: 13,
    fontWeight: "900",
  },
  
  heartBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  heartText: { color: "#fff", fontSize: 18, fontWeight: "900" },

  card: {
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  label: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: "800" },
  input: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  addStopBtn: { marginTop: 10, alignSelf: "flex-start" },
  addStopText: { color: "#9bdcff", fontWeight: "900" },

  stopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stopRemove: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  stopRemoveText: { color: "#fff", fontWeight: "900" },

  toggleRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleText: { color: "#fff", fontWeight: "700" },

  departureChip: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  departureChipText: { color: "#fff", fontWeight: "800" },

  primaryBtn: {
    marginTop: 14,
    backgroundColor: "#facc15",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "900" },

  clearBtn: { marginTop: 10, alignItems: "center" },
  clearText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  tabRow: { marginTop: 14, flexDirection: "row", gap: 10 },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  tabActive: {
    backgroundColor: "rgba(250,204,21,0.18)",
    borderColor: "rgba(250,204,21,0.30)",
  },
  tabText: { color: "rgba(255,255,255,0.75)", fontWeight: "900" },
  tabTextActive: { color: "#facc15" },

  muted: { marginTop: 10, color: "rgba(255,255,255,0.60)" },

  rowItem: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  rowText: { color: "#fff", fontWeight: "900" },
  rowHint: { color: "rgba(255,255,255,0.55)", marginTop: 4, fontSize: 12 },

  secondaryBtn: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  secondaryText: { color: "#fff", fontWeight: "800" },

  // Autocomplete styles
  suggestionsContainer: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "#1a2332",
    borderRadius: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    maxHeight: 200,
    zIndex: 1000,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  suggestionText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  loadingIndicator: {
    position: "absolute",
    right: 12,
    top: 12,
  },

  // Vehicle height styles
  vehicleHeightContainer: {
    marginTop: 14,
  },
  heightInputRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-end",
  },
  unitToggle: {
    flexDirection: "row",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    marginBottom: 0,
  },
  unitButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  unitButtonActive: {
    backgroundColor: "#facc15",
  },
  unitButtonText: {
    color: "rgba(255,255,255,0.75)",
    fontWeight: "800",
    fontSize: 13,
  },
  unitButtonTextActive: {
    color: "#111827",
  },
  helperText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    marginTop: 8,
    fontWeight: "600",
  },
});