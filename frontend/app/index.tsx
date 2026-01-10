import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Vehicle types for safety scoring
const VEHICLE_TYPES = [
  { id: 'car', label: 'Car/Sedan', icon: 'car-sport-outline' },
  { id: 'suv', label: 'SUV', icon: 'car-outline' },
  { id: 'truck', label: 'Pickup Truck', icon: 'car-outline' },
  { id: 'semi', label: 'Semi Truck', icon: 'bus-outline' },
  { id: 'rv', label: 'RV/Motorhome', icon: 'home-outline' },
  { id: 'motorcycle', label: 'Motorcycle', icon: 'bicycle-outline' },
  { id: 'trailer', label: 'Vehicle + Trailer', icon: 'train-outline' },
];

interface StopPoint {
  location: string;
  type: string;
}

interface SavedRoute {
  id: string;
  origin: string;
  destination: string;
  stops?: StopPoint[];
  is_favorite?: boolean;
  created_at: string;
}

interface AutocompleteSuggestion {
  place_name: string;
  short_name: string;
  coordinates: number[];
}

export default function HomeScreen() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [recentRoutes, setRecentRoutes] = useState<SavedRoute[]>([]);
  const [favoriteRoutes, setFavoriteRoutes] = useState<SavedRoute[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  
  // Autocomplete state
  const [originSuggestions, setOriginSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestSuggestions, setShowDestSuggestions] = useState(false);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  
  // Vehicle & Trucker mode
  const [vehicleType, setVehicleType] = useState('car');
  const [truckerMode, setTruckerMode] = useState(false);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  
  // Departure time
  const [departureTime, setDepartureTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [useCustomTime, setUseCustomTime] = useState(false);
  
  // AI Chat
  const [showChat, setShowChat] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>(['How to drive in snow?', 'Is fog dangerous?', 'Rest stop tips']);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  
  // Multi-stop
  const [stops, setStops] = useState<StopPoint[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopLocation, setNewStopLocation] = useState('');
  const [newStopType, setNewStopType] = useState('stop');

  // Check for speech recognition support on web
  useEffect(() => {
    if (Platform.OS === 'web') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSpeechSupported(!!SpeechRecognition);
    }
  }, []);

  useEffect(() => {
    fetchRecentRoutes();
    fetchFavoriteRoutes();
    loadCachedRoute();
  }, []);

  const loadCachedRoute = async () => {
    try {
      const cached = await AsyncStorage.getItem('lastRoute');
      if (cached) {
        const data = JSON.parse(cached);
        // Optionally pre-fill from cache
      }
    } catch (e) {
      console.log('No cached route');
    }
  };

  // Debounced autocomplete function
  const fetchAutocomplete = async (query: string, type: 'origin' | 'destination') => {
    if (query.length < 2) {
      if (type === 'origin') {
        setOriginSuggestions([]);
        setShowOriginSuggestions(false);
      } else {
        setDestSuggestions([]);
        setShowDestSuggestions(false);
      }
      return;
    }

    setAutocompleteLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/api/geocode/autocomplete`, {
        params: { query, limit: 5 }
      });
      
      if (type === 'origin') {
        setOriginSuggestions(response.data);
        setShowOriginSuggestions(response.data.length > 0);
      } else {
        setDestSuggestions(response.data);
        setShowDestSuggestions(response.data.length > 0);
      }
    } catch (err) {
      console.log('Autocomplete error:', err);
    } finally {
      setAutocompleteLoading(false);
    }
  };

  // Debounce timer refs
  const originDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const destDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOriginChange = (text: string) => {
    setOrigin(text);
    
    // Debounce autocomplete
    if (originDebounceRef.current) {
      clearTimeout(originDebounceRef.current);
    }
    originDebounceRef.current = setTimeout(() => {
      fetchAutocomplete(text, 'origin');
    }, 300);
  };

  const handleDestinationChange = (text: string) => {
    setDestination(text);
    
    // Debounce autocomplete
    if (destDebounceRef.current) {
      clearTimeout(destDebounceRef.current);
    }
    destDebounceRef.current = setTimeout(() => {
      fetchAutocomplete(text, 'destination');
    }, 300);
  };

  const selectOriginSuggestion = (suggestion: AutocompleteSuggestion) => {
    setOrigin(suggestion.place_name);
    setShowOriginSuggestions(false);
    setOriginSuggestions([]);
  };

  const selectDestSuggestion = (suggestion: AutocompleteSuggestion) => {
    setDestination(suggestion.place_name);
    setShowDestSuggestions(false);
    setDestSuggestions([]);
  };

  // AI Chat functions
  const sendChatMessage = async (message?: string) => {
    const msgToSend = message || chatMessage;
    if (!msgToSend.trim()) return;
    
    setChatLoading(true);
    setChatHistory(prev => [...prev, { role: 'user', text: msgToSend }]);
    setChatMessage('');
    
    try {
      const response = await axios.post(`${API_BASE}/api/chat`, {
        message: msgToSend,
        route_context: origin && destination ? `${origin} to ${destination}` : null
      });
      
      setChatHistory(prev => [...prev, { role: 'ai', text: response.data.response }]);
      if (response.data.suggestions) {
        setChatSuggestions(response.data.suggestions);
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'ai', text: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Voice-to-text function
  const startVoiceRecognition = () => {
    if (Platform.OS !== 'web') {
      alert('Voice input works in web browsers. On native devices, use the Expo Go app.');
      return;
    }

    // Check if we're in an iframe (which blocks speech recognition)
    const isInIframe = window !== window.parent;
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert('🎤 Speech recognition not supported.\n\nPlease use Chrome, Edge, or Safari browser.');
      return;
    }

    if (isInIframe) {
      alert('🎤 Voice input is blocked in preview mode.\n\nTo use voice:\n1. Open the app in a new tab (click the external link icon)\n2. Or deploy the app and test there\n\nThe feature will work perfectly in the standalone app!');
      return;
    }

    // Already listening, stop it
    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        console.log('Voice recognition started');
        setIsListening(true);
        setChatMessage('');
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setChatMessage(transcript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        
        if (event.error === 'not-allowed') {
          alert('🎤 Microphone access denied.\n\nClick the lock icon in your address bar to allow microphone access.');
        } else if (event.error === 'no-speech') {
          alert('No speech detected. Please try again.');
        } else {
          alert(`Voice error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err) {
      console.error('Failed to start recognition:', err);
      alert('Failed to start voice recognition. Please try a different browser.');
      setIsListening(false);
    }
  };

  const fetchRecentRoutes = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/routes/history`);
      setRecentRoutes(response.data.slice(0, 5));
    } catch (err) {
      console.log('Error fetching history:', err);
    }
  };

  const fetchFavoriteRoutes = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/routes/favorites`);
      setFavoriteRoutes(response.data);
    } catch (err) {
      console.log('Error fetching favorites:', err);
    }
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
        stops: stops,
        vehicle_type: vehicleType,
        trucker_mode: truckerMode,
      };
      
      if (useCustomTime) {
        requestData.departure_time = departureTime.toISOString();
      }

      const response = await axios.post(`${API_BASE}/api/route/weather`, requestData);
      
      // Cache the route for offline
      await AsyncStorage.setItem('lastRoute', JSON.stringify(response.data));

      router.push({
        pathname: '/route',
        params: { routeData: JSON.stringify(response.data) },
      });
    } catch (err: any) {
      console.error('Error:', err);
      setError(
        err.response?.data?.detail ||
          'Failed to get weather data. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRecentRoute = (route: SavedRoute) => {
    setOrigin(route.origin);
    setDestination(route.destination);
    if (route.stops) {
      setStops(route.stops);
    }
  };

  const addToFavorites = async () => {
    if (!origin.trim() || !destination.trim()) {
      setError('Enter a route first to save as favorite');
      return;
    }

    try {
      await axios.post(`${API_BASE}/api/routes/favorites`, {
        origin: origin.trim(),
        destination: destination.trim(),
        stops: stops,
      });
      fetchFavoriteRoutes();
    } catch (err) {
      console.error('Error saving favorite:', err);
    }
  };

  const removeFavorite = async (id: string) => {
    try {
      await axios.delete(`${API_BASE}/api/routes/favorites/${id}`);
      fetchFavoriteRoutes();
    } catch (err) {
      console.error('Error removing favorite:', err);
    }
  };

  const addStop = () => {
    if (newStopLocation.trim()) {
      setStops([...stops, { location: newStopLocation.trim(), type: newStopType }]);
      setNewStopLocation('');
      setShowAddStop(false);
    }
  };

  const removeStop = (index: number) => {
    setStops(stops.filter((_, i) => i !== index));
  };

  const swapLocations = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  const stopTypeIcons: Record<string, string> = {
    stop: 'location',
    gas: 'car',
    food: 'restaurant',
    rest: 'bed',
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
            {/* Main Card */}
            <View style={styles.mainCard}>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.iconContainer}>
                  <MaterialCommunityIcons name="routes" size={28} color="#1a1a1a" />
                </View>
                <View style={styles.headerText}>
                  <Text style={styles.title}>Routecast</Text>
                  <Text style={styles.subtitle}>Weather forecasts for your journey</Text>
                </View>
                <TouchableOpacity 
                  style={styles.favoriteButton}
                  onPress={addToFavorites}
                >
                  <Ionicons name="heart-outline" size={24} color="#eab308" />
                </TouchableOpacity>
              </View>

              {/* App Description */}
              <View style={styles.descriptionBox}>
                <Text style={styles.descriptionText}>
                  Plan your road trip with confidence. See real-time weather conditions, alerts, and AI-powered recommendations for every mile of your drive.
                </Text>
              </View>

              {/* Origin Input */}
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
                    onChangeText={handleOriginChange}
                    onFocus={() => origin.length >= 2 && setShowOriginSuggestions(originSuggestions.length > 0)}
                    onBlur={() => setTimeout(() => setShowOriginSuggestions(false), 200)}
                    returnKeyType="next"
                  />
                  {autocompleteLoading && origin.length >= 2 && (
                    <ActivityIndicator size="small" color="#eab308" style={{ marginRight: 8 }} />
                  )}
                </View>
                {/* Origin Suggestions Dropdown */}
                {showOriginSuggestions && originSuggestions.length > 0 && (
                  <View style={styles.suggestionsDropdown}>
                    {originSuggestions.map((suggestion, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.suggestionItem}
                        onPress={() => selectOriginSuggestion(suggestion)}
                      >
                        <Ionicons name="location-outline" size={16} color="#a1a1aa" />
                        <View style={styles.suggestionTextContainer}>
                          <Text style={styles.suggestionShortName}>{suggestion.short_name}</Text>
                          <Text style={styles.suggestionFullName} numberOfLines={1}>{suggestion.place_name}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Stops */}
              {stops.length > 0 && (
                <View style={styles.stopsContainer}>
                  {stops.map((stop, index) => (
                    <View key={index} style={styles.stopItem}>
                      <Ionicons 
                        name={stopTypeIcons[stop.type] as any || 'location'} 
                        size={16} 
                        color="#f59e0b" 
                      />
                      <Text style={styles.stopText} numberOfLines={1}>{stop.location}</Text>
                      <TouchableOpacity onPress={() => removeStop(index)}>
                        <Ionicons name="close-circle" size={18} color="#6b7280" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Add Stop Button */}
              <TouchableOpacity 
                style={styles.addStopButton}
                onPress={() => setShowAddStop(true)}
              >
                <Ionicons name="add-circle-outline" size={18} color="#60a5fa" />
                <Text style={styles.addStopText}>Add Stop</Text>
              </TouchableOpacity>

              {/* Destination Input */}
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
                    onChangeText={handleDestinationChange}
                    onFocus={() => destination.length >= 2 && setShowDestSuggestions(destSuggestions.length > 0)}
                    onBlur={() => setTimeout(() => setShowDestSuggestions(false), 200)}
                    returnKeyType="done"
                    onSubmitEditing={handleGetWeather}
                  />
                  {autocompleteLoading && destination.length >= 2 && (
                    <ActivityIndicator size="small" color="#eab308" style={{ marginRight: 8 }} />
                  )}
                  <TouchableOpacity onPress={swapLocations} style={styles.swapButton}>
                    <Ionicons name="swap-vertical" size={20} color="#60a5fa" />
                  </TouchableOpacity>
                </View>
                {/* Destination Suggestions Dropdown */}
                {showDestSuggestions && destSuggestions.length > 0 && (
                  <View style={styles.suggestionsDropdown}>
                    {destSuggestions.map((suggestion, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.suggestionItem}
                        onPress={() => selectDestSuggestion(suggestion)}
                      >
                        <Ionicons name="location-outline" size={16} color="#a1a1aa" />
                        <View style={styles.suggestionTextContainer}>
                          <Text style={styles.suggestionShortName}>{suggestion.short_name}</Text>
                          <Text style={styles.suggestionFullName} numberOfLines={1}>{suggestion.place_name}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Departure Time */}
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
                  <TouchableOpacity 
                    style={styles.timeButton}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Text style={styles.timeButtonText}>
                      {format(departureTime, 'MMM d, h:mm a')}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color="#6b7280" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Vehicle Type Selector */}
              <TouchableOpacity 
                style={styles.vehicleSelector}
                onPress={() => setShowVehicleSelector(true)}
              >
                <View style={styles.vehicleSelectorLeft}>
                  <Ionicons name={VEHICLE_TYPES.find(v => v.id === vehicleType)?.icon as any || 'car-sport-outline'} size={22} color="#60a5fa" />
                  <View>
                    <Text style={styles.vehicleLabel}>Vehicle Type</Text>
                    <Text style={styles.vehicleValue}>{VEHICLE_TYPES.find(v => v.id === vehicleType)?.label || 'Car'}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#6b7280" />
              </TouchableOpacity>

              {/* Trucker Mode Toggle */}
              <View style={styles.truckerToggle}>
                <View style={styles.alertsLeft}>
                  <Ionicons name="bus-outline" size={22} color="#f59e0b" />
                  <View>
                    <Text style={styles.alertsText}>Trucker Mode</Text>
                    <Text style={styles.truckerSubtext}>Wind & height warnings</Text>
                  </View>
                </View>
                <Switch
                  value={truckerMode}
                  onValueChange={setTruckerMode}
                  trackColor={{ false: '#3f3f46', true: '#f59e0b80' }}
                  thumbColor={truckerMode ? '#f59e0b' : '#71717a'}
                />
              </View>

              {/* Weather Alerts Toggle */}
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

              {/* Error Message */}
              {error ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={18} color="#ef4444" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Check Route Button */}
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

            {/* Tabs for Recent/Favorites */}
            <View style={styles.tabsContainer}>
              <TouchableOpacity 
                style={[styles.tab, !showFavorites && styles.tabActive]}
                onPress={() => setShowFavorites(false)}
              >
                <Ionicons name="time-outline" size={18} color={!showFavorites ? '#eab308' : '#6b7280'} />
                <Text style={[styles.tabText, !showFavorites && styles.tabTextActive]}>Recent</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.tab, showFavorites && styles.tabActive]}
                onPress={() => setShowFavorites(true)}
              >
                <Ionicons name="heart" size={18} color={showFavorites ? '#eab308' : '#6b7280'} />
                <Text style={[styles.tabText, showFavorites && styles.tabTextActive]}>Favorites</Text>
              </TouchableOpacity>
            </View>

            {/* Routes List */}
            <View style={styles.routesSection}>
              {(showFavorites ? favoriteRoutes : recentRoutes).length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons 
                    name={showFavorites ? "heart-outline" : "map-outline"} 
                    size={48} 
                    color="#374151" 
                  />
                  <Text style={styles.emptyText}>
                    {showFavorites ? 'No favorite routes' : 'No recent routes'}
                  </Text>
                </View>
              ) : (
                (showFavorites ? favoriteRoutes : recentRoutes).map((route) => (
                  <TouchableOpacity
                    key={route.id}
                    style={styles.routeCard}
                    onPress={() => handleRecentRoute(route)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.routeInfo}>
                      <View style={styles.routeLocations}>
                        <View style={styles.routeLocation}>
                          <View style={styles.routeDot} />
                          <Text style={styles.routeText} numberOfLines={1}>
                            {route.origin}
                          </Text>
                        </View>
                        {route.stops && route.stops.length > 0 && (
                          <View style={styles.routeStops}>
                            <Text style={styles.routeStopsText}>
                              +{route.stops.length} stop{route.stops.length > 1 ? 's' : ''}
                            </Text>
                          </View>
                        )}
                        <View style={styles.routeLocation}>
                          <View style={[styles.routeDot, styles.routeDotEnd]} />
                          <Text style={styles.routeText} numberOfLines={1}>
                            {route.destination}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {showFavorites ? (
                      <TouchableOpacity onPress={() => removeFavorite(route.id)}>
                        <Ionicons name="heart-dislike" size={20} color="#ef4444" />
                      </TouchableOpacity>
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Date Time Picker Modal */}
      {showDatePicker && (
        <Modal transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Departure Time</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
              
              {Platform.OS === 'web' ? (
                // Web-compatible date/time input
                <View style={styles.webDatePicker}>
                  <Text style={styles.datePickerLabel}>Date</Text>
                  <input
                    type="date"
                    value={departureTime.toISOString().split('T')[0]}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => {
                      const newDate = new Date(departureTime);
                      const [year, month, day] = e.target.value.split('-');
                      newDate.setFullYear(parseInt(year), parseInt(month) - 1, parseInt(day));
                      setDepartureTime(newDate);
                    }}
                    style={{
                      width: '100%',
                      padding: 12,
                      fontSize: 16,
                      backgroundColor: '#3f3f46',
                      border: '1px solid #52525b',
                      borderRadius: 8,
                      color: '#fff',
                      marginBottom: 16,
                    }}
                  />
                  
                  <Text style={styles.datePickerLabel}>Time</Text>
                  <input
                    type="time"
                    value={`${String(departureTime.getHours()).padStart(2, '0')}:${String(departureTime.getMinutes()).padStart(2, '0')}`}
                    onChange={(e) => {
                      const newDate = new Date(departureTime);
                      const [hours, minutes] = e.target.value.split(':');
                      newDate.setHours(parseInt(hours), parseInt(minutes));
                      setDepartureTime(newDate);
                    }}
                    style={{
                      width: '100%',
                      padding: 12,
                      fontSize: 16,
                      backgroundColor: '#3f3f46',
                      border: '1px solid #52525b',
                      borderRadius: 8,
                      color: '#fff',
                      marginBottom: 16,
                    }}
                  />
                  
                  <Text style={styles.selectedDateTime}>
                    Selected: {format(departureTime, 'MMM d, yyyy h:mm a')}
                  </Text>
                </View>
              ) : (
                // Native DateTimePicker for iOS/Android
                <DateTimePicker
                  value={departureTime}
                  mode="datetime"
                  display="spinner"
                  onChange={(event, date) => {
                    if (date) setDepartureTime(date);
                  }}
                  textColor="#fff"
                  minimumDate={new Date()}
                />
              )}
              
              <TouchableOpacity 
                style={styles.modalButton}
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={styles.modalButtonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Add Stop Modal */}
      {showAddStop && (
        <Modal transparent animationType="slide">
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
                  { type: 'stop', label: 'Stop', icon: 'location' },
                  { type: 'gas', label: 'Gas', icon: 'car' },
                  { type: 'food', label: 'Food', icon: 'restaurant' },
                  { type: 'rest', label: 'Rest', icon: 'bed' },
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
                      name={item.icon as any} 
                      size={20} 
                      color={newStopType === item.type ? '#eab308' : '#6b7280'} 
                    />
                    <Text style={[
                      styles.stopTypeText,
                      newStopType === item.type && styles.stopTypeTextActive
                    ]}>{item.label}</Text>
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

      {/* Vehicle Type Selector Modal */}
      {showVehicleSelector && (
        <Modal transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Vehicle Type</Text>
                <TouchableOpacity onPress={() => setShowVehicleSelector(false)}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
              
              <Text style={styles.vehicleModalSubtext}>
                Safety scores are customized for your vehicle
              </Text>
              
              <View style={styles.vehicleList}>
                {VEHICLE_TYPES.map((vehicle) => (
                  <TouchableOpacity
                    key={vehicle.id}
                    style={[
                      styles.vehicleOption,
                      vehicleType === vehicle.id && styles.vehicleOptionActive,
                    ]}
                    onPress={() => {
                      setVehicleType(vehicle.id);
                      setShowVehicleSelector(false);
                    }}
                  >
                    <Ionicons 
                      name={vehicle.icon as any} 
                      size={24} 
                      color={vehicleType === vehicle.id ? '#eab308' : '#6b7280'} 
                    />
                    <Text style={[
                      styles.vehicleOptionText,
                      vehicleType === vehicle.id && styles.vehicleOptionTextActive
                    ]}>{vehicle.label}</Text>
                    {vehicleType === vehicle.id && (
                      <Ionicons name="checkmark-circle" size={20} color="#eab308" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* AI Chat Modal */}
      {showChat && (
        <Modal transparent animationType="slide">
          <View style={styles.chatModalOverlay}>
            <View style={styles.chatModalContent}>
              <View style={styles.chatHeader}>
                <View style={styles.chatHeaderLeft}>
                  <Ionicons name="chatbubbles" size={24} color="#eab308" />
                  <Text style={styles.chatTitle}>Ask Routecast AI</Text>
                </View>
                <TouchableOpacity onPress={() => setShowChat(false)}>
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
              
              <ScrollView style={styles.chatMessages} showsVerticalScrollIndicator={false}>
                {chatHistory.length === 0 && (
                  <View style={styles.chatWelcome}>
                    <Text style={styles.chatWelcomeText}>👋 Hi! I'm your driving assistant.</Text>
                    <Text style={styles.chatWelcomeSubtext}>Ask me about weather, road conditions, or safe driving tips!</Text>
                  </View>
                )}
                
                {chatHistory.map((msg, idx) => (
                  <View key={idx} style={[styles.chatBubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                    <Text style={styles.chatBubbleText}>{msg.text}</Text>
                  </View>
                ))}
                
                {chatLoading && (
                  <View style={styles.chatTyping}>
                    <ActivityIndicator size="small" color="#eab308" />
                    <Text style={styles.chatTypingText}>Thinking...</Text>
                  </View>
                )}
              </ScrollView>
              
              {/* Quick suggestions */}
              <View style={styles.chatSuggestions}>
                {chatSuggestions.map((suggestion, idx) => (
                  <TouchableOpacity 
                    key={idx} 
                    style={styles.chatSuggestionBtn}
                    onPress={() => sendChatMessage(suggestion)}
                  >
                    <Text style={styles.chatSuggestionText}>{suggestion}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              {/* Input */}
              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInputFull}
                  placeholder="Type your question here..."
                  placeholderTextColor="#6b7280"
                  value={chatMessage}
                  onChangeText={setChatMessage}
                  onSubmitEditing={() => sendChatMessage()}
                  returnKeyType="send"
                />
                  placeholderTextColor="#6b7280"
                  value={chatMessage}
                  onChangeText={setChatMessage}
                  onSubmitEditing={() => sendChatMessage()}
                  returnKeyType="send"
                />
                <TouchableOpacity 
                  style={[styles.chatSendBtn, !chatMessage.trim() && styles.chatSendBtnDisabled]}
                  onPress={() => sendChatMessage()}
                  disabled={!chatMessage.trim() || chatLoading}
                >
                  <Ionicons name="send" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Floating Chat Button */}
      <TouchableOpacity style={styles.chatFab} onPress={() => setShowChat(true)}>
        <Ionicons name="chatbubble-ellipses" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  mapBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a1a',
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  mainCard: {
    backgroundColor: '#27272a',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#eab308',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    color: '#a1a1aa',
  },
  favoriteButton: {
    padding: 8,
  },
  descriptionBox: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#eab308',
  },
  descriptionText: {
    color: '#d4d4d8',
    fontSize: 12,
    lineHeight: 18,
  },
  inputSection: {
    marginBottom: 12,
  },
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
  originIcon: {
    marginRight: 10,
  },
  destinationIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#ffffff',
    paddingVertical: 12,
    fontWeight: '500',
  },
  swapButton: {
    padding: 8,
  },
  stopsContainer: {
    marginBottom: 8,
  },
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
  stopText: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 14,
  },
  addStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingVertical: 4,
  },
  addStopText: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '500',
  },
  departureSection: {
    marginBottom: 12,
  },
  departureToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  departureLabel: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 14,
  },
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
  timeButtonText: {
    color: '#eab308',
    fontSize: 14,
    fontWeight: '500',
  },
  alertsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 12,
  },
  alertsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alertsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    flex: 1,
  },
  button: {
    backgroundColor: '#eab308',
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#1a1a1a',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tabsContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
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
  tabActive: {
    backgroundColor: '#3f3f46',
  },
  tabText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#eab308',
  },
  routesSection: {
    minHeight: 100,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#27272a',
    borderRadius: 12,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 12,
  },
  routeCard: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeInfo: {
    flex: 1,
  },
  routeLocations: {
    gap: 2,
  },
  routeLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  routeDotEnd: {
    backgroundColor: '#ef4444',
  },
  routeText: {
    color: '#e4e4e7',
    fontSize: 13,
    flex: 1,
  },
  routeStops: {
    marginLeft: 16,
    paddingVertical: 2,
  },
  routeStopsText: {
    color: '#f59e0b',
    fontSize: 11,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
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
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
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
  stopTypes: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
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
  stopTypeText: {
    color: '#6b7280',
    fontSize: 11,
  },
  stopTypeTextActive: {
    color: '#eab308',
  },
  modalButton: {
    backgroundColor: '#eab308',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#1a1a1a',
    fontSize: 15,
    fontWeight: '700',
  },
  suggestionsDropdown: {
    backgroundColor: '#3f3f46',
    borderRadius: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#52525b',
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#52525b',
    gap: 10,
  },
  suggestionTextContainer: {
    flex: 1,
  },
  suggestionShortName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionFullName: {
    color: '#a1a1aa',
    fontSize: 11,
    marginTop: 2,
  },
  vehicleSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#3f3f46',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  vehicleSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  vehicleLabel: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '500',
  },
  vehicleValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  truckerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 8,
  },
  truckerSubtext: {
    color: '#6b7280',
    fontSize: 11,
  },
  vehicleModalSubtext: {
    color: '#a1a1aa',
    fontSize: 13,
    marginBottom: 16,
  },
  vehicleList: {
    gap: 8,
  },
  vehicleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3f3f46',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  vehicleOptionActive: {
    backgroundColor: '#52525b',
    borderWidth: 1,
    borderColor: '#eab308',
  },
  vehicleOptionText: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  vehicleOptionTextActive: {
    color: '#eab308',
  },
  webDatePicker: {
    paddingVertical: 16,
  },
  datePickerLabel: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  selectedDateTime: {
    color: '#eab308',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  // AI Chat styles
  chatFab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#eab308',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  chatModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  chatModalContent: {
    backgroundColor: '#1f1f23',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
    paddingBottom: 20,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#3f3f46',
  },
  chatHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chatTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  chatMessages: {
    flex: 1,
    padding: 16,
  },
  chatWelcome: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  chatWelcomeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  chatWelcomeSubtext: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  chatBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
  },
  userBubble: {
    backgroundColor: '#2563eb',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: '#3f3f46',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  chatBubbleText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  chatTyping: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
  },
  chatTypingText: {
    color: '#6b7280',
    fontSize: 12,
  },
  chatSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#3f3f46',
  },
  chatSuggestionBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  chatSuggestionText: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#27272a',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  chatInputFull: {
    flex: 1,
    backgroundColor: '#27272a',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  chatSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eab308',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatSendBtnDisabled: {
    backgroundColor: '#3f3f46',
  },
});
