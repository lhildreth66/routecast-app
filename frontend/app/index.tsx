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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
  const [recentRoutes, setRecentRoutes] = useState<SavedRoute[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetchRecentRoutes();
  }, []);

  const fetchRecentRoutes = async () => {
    try {
      setLoadingHistory(true);
      const response = await axios.get(`${API_BASE}/api/routes/history`);
      setRecentRoutes(response.data);
    } catch (err) {
      console.log('Error fetching history:', err);
    } finally {
      setLoadingHistory(false);
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

  const swapLocations = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Ionicons name="cloudy" size={40} color="#60a5fa" />
              <Text style={styles.title}>Routecast</Text>
            </View>
            <Text style={styles.subtitle}>
              Weather forecasts along your route
            </Text>
          </View>

          {/* Input Section */}
          <View style={styles.inputSection}>
            <View style={styles.inputContainer}>
              <View style={styles.inputWrapper}>
                <View style={styles.iconCircle}>
                  <Ionicons name="location" size={20} color="#22c55e" />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Starting point"
                  placeholderTextColor="#6b7280"
                  value={origin}
                  onChangeText={setOrigin}
                  returnKeyType="next"
                />
              </View>

              <TouchableOpacity
                style={styles.swapButton}
                onPress={swapLocations}
              >
                <Ionicons name="swap-vertical" size={24} color="#60a5fa" />
              </TouchableOpacity>

              <View style={styles.inputWrapper}>
                <View style={styles.iconCircle}>
                  <Ionicons name="flag" size={20} color="#ef4444" />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Destination"
                  placeholderTextColor="#6b7280"
                  value={destination}
                  onChangeText={setDestination}
                  returnKeyType="done"
                  onSubmitEditing={handleGetWeather}
                />
              </View>
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={18} color="#ef4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.button,
                loading && styles.buttonDisabled,
              ]}
              onPress={handleGetWeather}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="navigate" size={22} color="#fff" />
                  <Text style={styles.buttonText}>Get Route Weather</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Recent Routes */}
          <View style={styles.recentSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="time-outline" size={20} color="#9ca3af" />
              <Text style={styles.sectionTitle}>Recent Routes</Text>
            </View>

            {loadingHistory ? (
              <ActivityIndicator color="#60a5fa" style={styles.loader} />
            ) : recentRoutes.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="map-outline" size={48} color="#374151" />
                <Text style={styles.emptyText}>No recent routes</Text>
                <Text style={styles.emptySubtext}>
                  Your searched routes will appear here
                </Text>
              </View>
            ) : (
              recentRoutes.map((route) => (
                <TouchableOpacity
                  key={route.id}
                  style={styles.routeCard}
                  onPress={() => handleRecentRoute(route)}
                  activeOpacity={0.7}
                >
                  <View style={styles.routeInfo}>
                    <View style={styles.routeLocations}>
                      <View style={styles.routeLocation}>
                        <Ionicons name="ellipse" size={10} color="#22c55e" />
                        <Text style={styles.routeText} numberOfLines={1}>
                          {route.origin}
                        </Text>
                      </View>
                      <View style={styles.routeDots}>
                        <Ionicons
                          name="ellipsis-vertical"
                          size={12}
                          color="#4b5563"
                        />
                      </View>
                      <View style={styles.routeLocation}>
                        <Ionicons name="ellipse" size={10} color="#ef4444" />
                        <Text style={styles.routeText} numberOfLines={1}>
                          {route.destination}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#6b7280" />
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Features */}
          <View style={styles.featuresSection}>
            <View style={styles.featureRow}>
              <View style={styles.featureItem}>
                <Ionicons name="rainy" size={24} color="#60a5fa" />
                <Text style={styles.featureText}>Live Weather</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="warning" size={24} color="#f59e0b" />
                <Text style={styles.featureText}>Alerts</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="sparkles" size={24} color="#a855f7" />
                <Text style={styles.featureText}>AI Summary</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 20,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 4,
  },
  inputSection: {
    marginBottom: 32,
  },
  inputContainer: {
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 6,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1f1f1f',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    paddingVertical: 12,
  },
  swapButton: {
    alignSelf: 'center',
    padding: 8,
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    marginVertical: 4,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonDisabled: {
    backgroundColor: '#1e40af',
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  recentSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#9ca3af',
  },
  loader: {
    marginVertical: 20,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 16,
    marginTop: 12,
  },
  emptySubtext: {
    color: '#4b5563',
    fontSize: 14,
    marginTop: 4,
  },
  routeCard: {
    backgroundColor: '#1f1f1f',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
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
    gap: 10,
  },
  routeDots: {
    marginLeft: 3,
    marginVertical: -4,
  },
  routeText: {
    color: '#e5e7eb',
    fontSize: 15,
    flex: 1,
  },
  featuresSection: {
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    padding: 20,
  },
  featureRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  featureItem: {
    alignItems: 'center',
    gap: 8,
  },
  featureText: {
    color: '#9ca3af',
    fontSize: 13,
  },
});
