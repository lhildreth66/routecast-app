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
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import axios from 'axios';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface SavedRoute {
  id: string;
  origin: string;
  destination: string;
  created_at: string;
}

export default function HomeScreen() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [recentRoutes, setRecentRoutes] = useState<SavedRoute[]>([]);

  useEffect(() => {
    fetchRecentRoutes();
  }, []);

  const fetchRecentRoutes = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/routes/history`);
      setRecentRoutes(response.data.slice(0, 3));
    } catch (err) {
      console.log('Error fetching history:', err);
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
      const response = await axios.post(`${API_BASE}/api/route/weather`, {
        origin: origin.trim(),
        destination: destination.trim(),
      });

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
  };

  return (
    <View style={styles.container}>
      {/* Map Background Pattern */}
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
                  <Text style={styles.title}>Route Planner</Text>
                  <Text style={styles.subtitle}>Check weather along your drive</Text>
                </View>
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
                    onChangeText={setOrigin}
                    returnKeyType="next"
                  />
                </View>
              </View>

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
                    onChangeText={setDestination}
                    returnKeyType="done"
                    onSubmitEditing={handleGetWeather}
                  />
                </View>
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

            {/* Recent Routes */}
            {recentRoutes.length > 0 && (
              <View style={styles.recentSection}>
                <Text style={styles.recentTitle}>Recent Routes</Text>
                {recentRoutes.map((route) => (
                  <TouchableOpacity
                    key={route.id}
                    style={styles.recentCard}
                    onPress={() => handleRecentRoute(route)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.recentRoute}>
                      <View style={styles.recentLocation}>
                        <View style={styles.recentDot} />
                        <Text style={styles.recentText} numberOfLines={1}>
                          {route.origin}
                        </Text>
                      </View>
                      <View style={styles.recentArrow}>
                        <Ionicons name="arrow-down" size={14} color="#6b7280" />
                      </View>
                      <View style={styles.recentLocation}>
                        <View style={[styles.recentDot, styles.recentDotEnd]} />
                        <Text style={styles.recentText} numberOfLines={1}>
                          {route.destination}
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
    paddingTop: 24,
    paddingBottom: 40,
  },
  mainCard: {
    backgroundColor: '#27272a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#eab308',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#a1a1aa',
  },
  inputSection: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a1a1aa',
    letterSpacing: 1,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3f3f46',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#52525b',
    paddingHorizontal: 14,
  },
  originIcon: {
    marginRight: 12,
  },
  destinationIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#ffffff',
    paddingVertical: 14,
    fontWeight: '500',
  },
  alertsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginBottom: 16,
  },
  alertsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alertsText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    flex: 1,
  },
  button: {
    backgroundColor: '#eab308',
    borderRadius: 12,
    paddingVertical: 16,
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
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  recentSection: {
    marginTop: 8,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a1a1aa',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  recentCard: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentRoute: {
    flex: 1,
  },
  recentLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  recentDotEnd: {
    backgroundColor: '#ef4444',
  },
  recentArrow: {
    marginLeft: 4,
    marginVertical: 2,
  },
  recentText: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
});
