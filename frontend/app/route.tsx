import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  Platform,
  Share,
  Linking,
  Modal,
  TextInput,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { format, parseISO } from 'date-fns';
import axios from 'axios';
import { WebView } from 'react-native-webview';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Types
interface RoadCondition {
  condition: string;
  severity: number;
  label: string;
  icon: string;
  color: string;
  description: string;
  recommendation: string;
}

interface TurnByTurnStep {
  instruction: string;
  distance_miles: number;
  duration_minutes: number;
  road_name: string;
  maneuver: string;
  road_condition: RoadCondition | null;
  weather_at_step: string | null;
  temperature: number | null;
  has_alert: boolean;
}

interface WeatherData {
  temperature: number | null;
  conditions: string | null;
  wind_speed: string | null;
  humidity: number | null;
}

interface WeatherAlert {
  event: string;
  headline: string;
  severity: string;
}

interface WaypointWeather {
  waypoint: {
    lat: number;
    lon: number;
    name: string;
    distance_from_start: number | null;
    eta_minutes: number | null;
    arrival_time: string | null;
  };
  weather: WeatherData | null;
  alerts: WeatherAlert[];
}

interface SafetyScore {
  overall_score: number;
  risk_level: string;
  vehicle_type: string;
  factors: string[];
  recommendations: string[];
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

interface RouteData {
  id: string;
  origin: string;
  destination: string;
  total_duration_minutes: number | null;
  total_distance_miles: number | null;
  waypoints: WaypointWeather[];
  safety_score: SafetyScore | null;
  hazard_alerts: HazardAlert[];
  turn_by_turn: TurnByTurnStep[];
  road_condition_summary: string | null;
  worst_road_condition: string | null;
  reroute_recommended: boolean;
  reroute_reason: string | null;
  trucker_warnings: string[];
  ai_summary: string | null;
}

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const getManeuverIcon = (maneuver: string): string => {
  const icons: { [key: string]: string } = {
    'turn-right': 'arrow-forward',
    'turn-left': 'arrow-back',
    'merge': 'git-merge-outline',
    'straight': 'arrow-up',
    'depart': 'navigate',
    'arrive': 'flag',
    'roundabout': 'reload',
    'exit': 'exit-outline',
    'fork': 'git-branch-outline',
  };
  return icons[maneuver] || 'arrow-forward';
};

// Generate radar map HTML using RainViewer API (free weather radar)
const generateRadarMapHtml = (centerLat: number, centerLon: number): string => {
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
        .legend {
          position: absolute;
          bottom: 60px;
          left: 10px;
          background: rgba(24,24,27,0.95);
          padding: 10px 12px;
          border-radius: 10px;
          z-index: 1000;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .legend-title {
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        .legend-color {
          width: 20px;
          height: 12px;
          border-radius: 3px;
        }
        .legend-label {
          color: #a1a1aa;
          font-size: 10px;
        }
        .time-display {
          position: absolute;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(24,24,27,0.95);
          padding: 8px 16px;
          border-radius: 20px;
          color: #eab308;
          font-size: 12px;
          font-weight: 600;
          z-index: 1000;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .controls {
          position: absolute;
          bottom: 10px;
          right: 10px;
          display: flex;
          gap: 8px;
          z-index: 1000;
        }
        .control-btn {
          background: rgba(24,24,27,0.95);
          border: none;
          color: #fff;
          width: 36px;
          height: 36px;
          border-radius: 18px;
          font-size: 16px;
          cursor: pointer;
        }
        .control-btn:active { background: #3f3f46; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <div class="legend">
        <div class="legend-title">RADAR</div>
        <div class="legend-item">
          <div class="legend-color" style="background: #00ff00;"></div>
          <span class="legend-label">Light Rain</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #ffff00;"></div>
          <span class="legend-label">Moderate</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #ff8800;"></div>
          <span class="legend-label">Heavy</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #ff0000;"></div>
          <span class="legend-label">Intense</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #ff00ff;"></div>
          <span class="legend-label">Extreme</span>
        </div>
      </div>
      <div class="time-display" id="timeDisplay">Loading radar...</div>
      <div class="controls">
        <button class="control-btn" id="playBtn">▶</button>
      </div>
      <script>
        var map = L.map('map', { 
          zoomControl: false,
          attributionControl: false
        }).setView([${centerLat}, ${centerLon}], 7);
        
        // Dark base map
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 19
        }).addTo(map);
        
        // RainViewer radar layer
        var radarLayer = null;
        var radarFrames = [];
        var currentFrame = 0;
        var isPlaying = false;
        var playInterval = null;
        
        // Fetch available radar timestamps from RainViewer
        fetch('https://api.rainviewer.com/public/weather-maps.json')
          .then(response => response.json())
          .then(data => {
            radarFrames = data.radar.past.concat(data.radar.nowcast || []);
            if (radarFrames.length > 0) {
              currentFrame = radarFrames.length - 1; // Start with most recent
              showRadarFrame(currentFrame);
            }
          })
          .catch(err => {
            document.getElementById('timeDisplay').textContent = 'Radar unavailable';
          });
        
        function showRadarFrame(index) {
          if (index < 0 || index >= radarFrames.length) return;
          
          var frame = radarFrames[index];
          var timestamp = new Date(frame.time * 1000);
          var timeStr = timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          
          document.getElementById('timeDisplay').textContent = 'Radar: ' + timeStr;
          
          if (radarLayer) {
            map.removeLayer(radarLayer);
          }
          
          radarLayer = L.tileLayer(
            'https://tilecache.rainviewer.com' + frame.path + '/256/{z}/{x}/{y}/4/1_1.png',
            {
              opacity: 0.7,
              zIndex: 100
            }
          ).addTo(map);
        }
        
        // Play/pause animation
        document.getElementById('playBtn').onclick = function() {
          if (isPlaying) {
            clearInterval(playInterval);
            isPlaying = false;
            this.textContent = '▶';
          } else {
            isPlaying = true;
            this.textContent = '⏸';
            playInterval = setInterval(function() {
              currentFrame = (currentFrame + 1) % radarFrames.length;
              showRadarFrame(currentFrame);
            }, 500);
          }
        };
      </script>
    </body>
    </html>
  `;
};

export default function RouteScreen() {
  const params = useLocalSearchParams();
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'conditions' | 'directions' | 'alerts'>('conditions');
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Radar map state
  const [showRadarMap, setShowRadarMap] = useState(false);
  
  // AI Chat state
  const [showChat, setShowChat] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>(['Road condition tips', 'Safe driving advice', 'Weather questions']);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    if (params.routeData) {
      try {
        const data = JSON.parse(params.routeData as string);
        setRouteData(data);
      } catch (e) {
        console.error('Error parsing route data:', e);
      }
    }
    setLoading(false);
  }, [params.routeData]);

  // AI Chat functions
  const sendChatMessage = async (message?: string) => {
    const msgToSend = message || chatMessage;
    if (!msgToSend.trim()) return;
    
    setChatLoading(true);
    setChatHistory(prev => [...prev, { role: 'user', text: msgToSend }]);
    setChatMessage('');
    
    try {
      const routeContext = routeData ? `${routeData.origin} to ${routeData.destination}, ${routeData.road_condition_summary}` : null;
      const response = await axios.post(`${API_BASE}/api/chat`, {
        message: msgToSend,
        route_context: routeContext
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

  // Voice recognition
  const startVoiceRecognition = () => {
    if (Platform.OS !== 'web') {
      alert('Voice input works in web browsers.');
      return;
    }

    const isInIframe = window !== window.parent;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert('Speech recognition not supported. Try Chrome or Edge.');
      return;
    }

    if (isInIframe) {
      alert('🎤 Voice input blocked in preview.\n\nDeploy the app or open in new tab to use voice.');
      return;
    }

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
        setIsListening(true);
        setChatMessage('');
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setChatMessage(transcript);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognition.start();
    } catch (err) {
      alert('Failed to start voice recognition.');
      setIsListening(false);
    }
  };

  const speakSummary = async () => {
    if (!routeData) return;
    
    if (isSpeaking) {
      await Speech.stop();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);
    
    const parts: string[] = [];
    parts.push(`Route from ${routeData.origin} to ${routeData.destination}.`);
    
    if (routeData.total_distance_miles) {
      parts.push(`Total distance: ${Math.round(routeData.total_distance_miles)} miles.`);
    }
    if (routeData.total_duration_minutes) {
      parts.push(`Estimated time: ${formatDuration(routeData.total_duration_minutes)}.`);
    }
    
    // Safety score
    if (routeData.safety_score) {
      parts.push(`Safety score: ${routeData.safety_score.overall_score} out of 100. Risk level: ${routeData.safety_score.risk_level}.`);
    }
    
    // Road conditions
    if (routeData.road_condition_summary) {
      parts.push(routeData.road_condition_summary);
    }
    
    // Reroute recommendation
    if (routeData.reroute_recommended && routeData.reroute_reason) {
      parts.push(`Warning! Reroute recommended. ${routeData.reroute_reason}`);
    }
    
    // Hazards
    if (routeData.hazard_alerts?.length > 0) {
      parts.push(`${routeData.hazard_alerts.length} weather hazards along your route.`);
      routeData.hazard_alerts.slice(0, 3).forEach(alert => {
        parts.push(`${alert.countdown_text}. ${alert.recommendation}`);
      });
    }
    
    Speech.speak(parts.join(' '), {
      language: 'en-US',
      rate: 0.9,
      onDone: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  };

  const openInMaps = () => {
    if (!routeData) return;
    const url = Platform.select({
      ios: `maps://app?saddr=${encodeURIComponent(routeData.origin)}&daddr=${encodeURIComponent(routeData.destination)}`,
      android: `google.navigation:q=${encodeURIComponent(routeData.destination)}`,
      default: `https://www.google.com/maps/dir/${encodeURIComponent(routeData.origin)}/${encodeURIComponent(routeData.destination)}`,
    });
    Linking.openURL(url);
  };

  const shareRoute = async () => {
    if (!routeData) return;
    
    let message = `🚗 ROUTECAST ROAD CONDITIONS\n\n`;
    message += `📍 ${routeData.origin} → ${routeData.destination}\n`;
    message += `📏 ${routeData.total_distance_miles} mi | ⏱ ${routeData.total_duration_minutes ? formatDuration(routeData.total_duration_minutes) : 'N/A'}\n\n`;
    
    if (routeData.safety_score) {
      message += `🛡 Safety Score: ${routeData.safety_score.overall_score}/100 (${routeData.safety_score.risk_level.toUpperCase()})\n`;
    }
    
    message += `\n🛣 Road Conditions:\n${routeData.road_condition_summary || 'Good conditions'}\n`;
    
    if (routeData.reroute_recommended) {
      message += `\n⚠️ REROUTE RECOMMENDED: ${routeData.reroute_reason}\n`;
    }
    
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        alert('Copied to clipboard!');
      } else {
        await Share.share({ message, title: 'Routecast Road Conditions' });
      }
    } catch (e) {
      console.error('Share error:', e);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#eab308" />
        <Text style={styles.loadingText}>Loading route conditions...</Text>
      </SafeAreaView>
    );
  }

  if (!routeData) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={48} color="#ef4444" />
        <Text style={styles.errorText}>Unable to load route data</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const getSafetyColor = (score: number) => {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#eab308';
    if (score >= 40) return '#f97316';
    return '#ef4444';
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {routeData.origin.split(',')[0]} → {routeData.destination.split(',')[0]}
          </Text>
          <Text style={styles.headerSubtitle}>
            {routeData.total_distance_miles ? `${Math.round(routeData.total_distance_miles)} mi` : ''} • {routeData.total_duration_minutes ? formatDuration(routeData.total_duration_minutes) : ''}
            {routeData.safety_score ? ` • Safety: ${routeData.safety_score.overall_score}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowRadarMap(true)} style={styles.radarBtn}>
          <Ionicons name="radio-outline" size={18} color="#22c55e" />
          <Text style={styles.radarBtnText}>Radar</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={speakSummary} style={styles.speakBtn}>
          <Ionicons name={isSpeaking ? "stop-circle" : "volume-high"} size={24} color={isSpeaking ? "#ef4444" : "#60a5fa"} />
        </TouchableOpacity>
      </View>

      {/* Radar Map Modal */}
      {showRadarMap && (
        <Modal transparent animationType="slide">
          <View style={styles.radarModalOverlay}>
            <View style={styles.radarModalContent}>
              <View style={styles.radarHeader}>
                <View style={styles.radarHeaderLeft}>
                  <Ionicons name="radio-outline" size={24} color="#22c55e" />
                  <Text style={styles.radarTitle}>Live Weather Radar</Text>
                </View>
                <TouchableOpacity onPress={() => setShowRadarMap(false)}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
              
              {Platform.OS === 'web' ? (
                <iframe
                  srcDoc={generateRadarMapHtml(
                    routeData.waypoints[Math.floor(routeData.waypoints.length / 2)]?.waypoint.lat || 39.8283,
                    routeData.waypoints[Math.floor(routeData.waypoints.length / 2)]?.waypoint.lon || -98.5795
                  )}
                  style={{ flex: 1, border: 'none', width: '100%', height: '100%' }}
                />
              ) : (
                <WebView
                  source={{ html: generateRadarMapHtml(
                    routeData.waypoints[Math.floor(routeData.waypoints.length / 2)]?.waypoint.lat || 39.8283,
                    routeData.waypoints[Math.floor(routeData.waypoints.length / 2)]?.waypoint.lon || -98.5795
                  )}}
                  style={styles.radarWebView}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                />
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Reroute Warning */}
      {routeData.reroute_recommended && (
        <TouchableOpacity style={styles.rerouteWarning} onPress={openInMaps}>
          <View style={styles.rerouteIcon}>
            <Ionicons name="warning" size={24} color="#fff" />
          </View>
          <View style={styles.rerouteText}>
            <Text style={styles.rerouteTitle}>⚠️ REROUTE RECOMMENDED</Text>
            <Text style={styles.rerouteReason} numberOfLines={2}>{routeData.reroute_reason}</Text>
          </View>
          <Ionicons name="navigate" size={20} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Road Condition Summary */}
      <View style={styles.conditionSummary}>
        <Text style={styles.conditionSummaryText}>
          {routeData.road_condition_summary || '✅ Good road conditions expected'}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'conditions' && styles.tabActive]}
          onPress={() => setActiveTab('conditions')}
        >
          <Ionicons name="car" size={18} color={activeTab === 'conditions' ? '#eab308' : '#6b7280'} />
          <Text style={[styles.tabText, activeTab === 'conditions' && styles.tabTextActive]}>Road</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'directions' && styles.tabActive]}
          onPress={() => setActiveTab('directions')}
        >
          <Ionicons name="navigate" size={18} color={activeTab === 'directions' ? '#eab308' : '#6b7280'} />
          <Text style={[styles.tabText, activeTab === 'directions' && styles.tabTextActive]}>Directions</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'alerts' && styles.tabActive]}
          onPress={() => setActiveTab('alerts')}
        >
          <Ionicons name="warning" size={18} color={activeTab === 'alerts' ? '#ef4444' : '#6b7280'} />
          <Text style={[styles.tabText, activeTab === 'alerts' && styles.tabTextActive]}>Alerts</Text>
          {routeData.hazard_alerts?.length > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{routeData.hazard_alerts.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Road Conditions Tab */}
        {activeTab === 'conditions' && (
          <View style={styles.conditionsTab}>
            {/* Trucker Warnings */}
            {routeData.trucker_warnings && routeData.trucker_warnings.length > 0 && (
              <View style={styles.truckerBox}>
                <Text style={styles.truckerTitle}>🚛 TRUCKER ALERTS</Text>
                {routeData.trucker_warnings.map((warning, idx) => (
                  <Text key={idx} style={styles.truckerWarning}>{warning}</Text>
                ))}
              </View>
            )}

            {/* Waypoint Road Conditions */}
            <Text style={styles.sectionTitle}>🛣️ Road Surface Conditions</Text>
            <Text style={styles.sectionSubtitle}>Based on current weather at each location</Text>
            {routeData.waypoints.map((wp, index) => {
              // Derive road condition from weather
              const temp = wp.weather?.temperature || 50;
              const conditions = (wp.weather?.conditions || '').toLowerCase();
              const hasAlert = wp.alerts.length > 0;
              const windSpeed = wp.weather?.wind_speed ? parseInt(wp.weather.wind_speed) : 0;
              
              let condIcon = '✓';
              let condLabel = 'DRY';
              let condColor = '#22c55e';
              let condDesc = 'Roads clear and dry';
              let roadSurface = 'Normal driving conditions';
              
              if (hasAlert) {
                condIcon = '⚠️';
                condLabel = 'HAZARD';
                condColor = '#ef4444';
                condDesc = wp.alerts[0]?.event || 'Weather alert active';
                roadSurface = 'Check conditions before driving';
              } else if (temp <= 32 && (conditions.includes('rain') || conditions.includes('freezing') || conditions.includes('drizzle'))) {
                condIcon = '🧊';
                condLabel = 'ICY';
                condColor = '#ef4444';
                condDesc = `BLACK ICE LIKELY - ${temp}°F`;
                roadSurface = 'Roads may be ice-covered. Reduce speed significantly.';
              } else if (temp <= 32 && conditions.includes('snow')) {
                condIcon = '❄️';
                condLabel = 'SNOW';
                condColor = '#60a5fa';
                condDesc = `SNOW-COVERED ROADS - ${temp}°F`;
                roadSurface = 'Snow accumulation on roadway. Use caution.';
              } else if (temp > 32 && temp <= 40 && conditions.includes('snow')) {
                condIcon = '🌨️';
                condLabel = 'SLUSH';
                condColor = '#f59e0b';
                condDesc = `SLUSHY CONDITIONS - ${temp}°F`;
                roadSurface = 'Wet, slushy roads. Reduced traction.';
              } else if (conditions.includes('fog') || conditions.includes('mist')) {
                condIcon = '🌫️';
                condLabel = 'FOG';
                condColor = '#9ca3af';
                condDesc = 'LIMITED VISIBILITY';
                roadSurface = 'Use low beams. Increase following distance.';
              } else if (conditions.includes('rain') || conditions.includes('shower') || conditions.includes('drizzle')) {
                condIcon = '💧';
                condLabel = 'WET';
                condColor = '#3b82f6';
                condDesc = 'WET ROADS';
                roadSurface = 'Reduced traction. Watch for hydroplaning.';
              } else if (conditions.includes('thunder') || conditions.includes('storm')) {
                condIcon = '⛈️';
                condLabel = 'STORM';
                condColor = '#7c3aed';
                condDesc = 'STORM CONDITIONS';
                roadSurface = 'Heavy rain, possible flooding. Consider delaying.';
              } else if (windSpeed > 30) {
                condIcon = '💨';
                condLabel = 'WINDY';
                condColor = '#f59e0b';
                condDesc = `HIGH WINDS - ${windSpeed} mph`;
                roadSurface = 'Crosswinds may affect vehicle control.';
              }
              
              return (
                <View key={index} style={styles.conditionCard}>
                  <View style={[styles.conditionBadge, { backgroundColor: condColor }]}>
                    <Text style={styles.conditionIcon}>{condIcon}</Text>
                    <Text style={styles.conditionLabel}>{condLabel}</Text>
                  </View>
                  <View style={styles.conditionInfo}>
                    <Text style={styles.conditionLocation} numberOfLines={1}>
                      {wp.waypoint.name || `Mile ${Math.round(wp.waypoint.distance_from_start || 0)}`}
                    </Text>
                    <Text style={styles.conditionDesc}>{condDesc}</Text>
                    <Text style={styles.roadSurface}>{roadSurface}</Text>
                    <Text style={styles.conditionWeather}>
                      Weather: {wp.weather?.temperature}°F • {wp.weather?.conditions || 'Clear'}
                    </Text>
                  </View>
                  <View style={styles.conditionMeta}>
                    <Text style={styles.conditionMiles}>
                      {Math.round(wp.waypoint.distance_from_start || 0)} mi
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Turn-by-Turn Directions Tab */}
        {activeTab === 'directions' && (
          <View style={styles.directionsTab}>
            <TouchableOpacity style={styles.openMapsBtn} onPress={openInMaps}>
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.openMapsText}>Open in Maps App</Text>
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>Turn-by-Turn with Road Conditions</Text>
            
            {routeData.turn_by_turn && routeData.turn_by_turn.length > 0 ? (
              routeData.turn_by_turn.map((step, index) => (
                <View key={index} style={[styles.stepCard, step.has_alert && styles.stepCardAlert]}>
                  <View style={styles.stepIcon}>
                    <Ionicons 
                      name={getManeuverIcon(step.maneuver) as any} 
                      size={20} 
                      color={step.has_alert ? '#ef4444' : '#60a5fa'} 
                    />
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepInstruction}>{step.instruction}</Text>
                    <Text style={styles.stepRoad}>{step.road_name}</Text>
                    <View style={styles.stepMeta}>
                      <Text style={styles.stepDistance}>{step.distance_miles} mi</Text>
                      {step.road_condition && (
                        <View style={[styles.stepConditionBadge, { backgroundColor: step.road_condition.color }]}>
                          <Text style={styles.stepConditionText}>
                            {step.road_condition.icon} {step.road_condition.label}
                          </Text>
                        </View>
                      )}
                      {step.temperature && (
                        <Text style={styles.stepTemp}>{step.temperature}°F</Text>
                      )}
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.noDirections}>
                <Ionicons name="navigate-outline" size={48} color="#6b7280" />
                <Text style={styles.noDirectionsText}>Tap "Open in Maps App" for navigation</Text>
              </View>
            )}
          </View>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <View style={styles.alertsTab}>
            <Text style={styles.sectionTitle}>Hazard Countdown Alerts</Text>
            
            {routeData.hazard_alerts && routeData.hazard_alerts.length > 0 ? (
              routeData.hazard_alerts.map((alert, index) => (
                <View key={index} style={[
                  styles.alertCard,
                  alert.severity === 'extreme' ? styles.alertExtreme :
                  alert.severity === 'high' ? styles.alertHigh : styles.alertMedium
                ]}>
                  <View style={styles.alertHeader}>
                    <Ionicons 
                      name={
                        alert.type === 'ice' ? 'snow' :
                        alert.type === 'rain' ? 'rainy' :
                        alert.type === 'wind' ? 'cloudy' :
                        'warning'
                      } 
                      size={28} 
                      color="#fff" 
                    />
                    <View style={styles.alertInfo}>
                      <Text style={styles.alertCountdown}>{alert.countdown_text}</Text>
                      <Text style={styles.alertMessage}>{alert.message}</Text>
                    </View>
                  </View>
                  <View style={styles.alertAction}>
                    <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                    <Text style={styles.alertRec}>{alert.recommendation}</Text>
                  </View>
                  <View style={styles.alertMeta}>
                    <Text style={styles.alertDistance}>📍 {Math.round(alert.distance_miles)} mi</Text>
                    <Text style={styles.alertEta}>⏱ {alert.eta_minutes} min</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.noAlerts}>
                <Ionicons name="checkmark-circle" size={64} color="#22c55e" />
                <Text style={styles.noAlertsTitle}>All Clear!</Text>
                <Text style={styles.noAlertsText}>No significant hazards on your route</Text>
              </View>
            )}
          </View>
        )}
        
        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionBtn} onPress={shareRoute}>
          <Ionicons name="share-outline" size={22} color="#fff" />
          <Text style={styles.actionText}>Share</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} onPress={openInMaps}>
          <Ionicons name="navigate" size={24} color="#fff" />
          <Text style={styles.navText}>Start Navigation</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={speakSummary}>
          <Ionicons name={isSpeaking ? "stop" : "volume-high"} size={22} color="#fff" />
          <Text style={styles.actionText}>{isSpeaking ? 'Stop' : 'Listen'}</Text>
        </TouchableOpacity>
      </View>

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
                    <Text style={styles.chatWelcomeText}>👋 Ask about your route!</Text>
                    <Text style={styles.chatWelcomeSubtext}>I can help with road conditions, weather, and safe driving tips.</Text>
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
              
              {isListening && (
                <View style={styles.listeningIndicator}>
                  <Text style={styles.listeningText}>🎤 Listening...</Text>
                </View>
              )}
              
              <View style={styles.chatInputRow}>
                <TouchableOpacity style={[styles.micBtn, isListening && styles.micBtnActive]} onPress={startVoiceRecognition}>
                  <Ionicons name={isListening ? "radio-button-on" : "mic"} size={22} color={isListening ? "#ef4444" : "#fff"} />
                </TouchableOpacity>
                <TextInput
                  style={styles.chatInput}
                  placeholder="Type or tap mic to speak..."
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#18181b',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#18181b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#a1a1aa',
    marginTop: 16,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#18181b',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    marginTop: 12,
  },
  backButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#3f3f46',
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#27272a',
    borderBottomWidth: 1,
    borderBottomColor: '#3f3f46',
  },
  backBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  speakBtn: {
    padding: 4,
  },
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 5,
  },
  safetyLeft: {
    alignItems: 'center',
    marginRight: 16,
  },
  safetyScore: {
    fontSize: 32,
    fontWeight: '800',
  },
  safetyLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
  },
  safetyRight: {
    flex: 1,
  },
  safetyRisk: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  safetyVehicle: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  rerouteWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#b91c1c',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
  },
  rerouteIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rerouteText: {
    flex: 1,
  },
  rerouteTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  rerouteReason: {
    color: '#fecaca',
    fontSize: 12,
    marginTop: 2,
  },
  conditionSummary: {
    backgroundColor: '#27272a',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
  },
  conditionSummaryText: {
    color: '#e4e4e7',
    fontSize: 13,
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#27272a',
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#3f3f46',
  },
  tabText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#eab308',
  },
  tabBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 12,
  },
  conditionsTab: {},
  truckerBox: {
    backgroundColor: '#422006',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  truckerTitle: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  truckerWarning: {
    color: '#fde68a',
    fontSize: 12,
    marginBottom: 4,
  },
  conditionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  conditionBadge: {
    width: 56,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 12,
  },
  conditionIcon: {
    fontSize: 20,
  },
  conditionLabel: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  conditionInfo: {
    flex: 1,
  },
  conditionLocation: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  conditionDesc: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  conditionWeather: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  conditionMeta: {
    alignItems: 'flex-end',
  },
  conditionMiles: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '600',
  },
  directionsTab: {},
  openMapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  openMapsText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  stepCard: {
    flexDirection: 'row',
    backgroundColor: '#27272a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  stepCardAlert: {
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepContent: {
    flex: 1,
  },
  stepInstruction: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  stepRoad: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  stepMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  stepDistance: {
    color: '#6b7280',
    fontSize: 11,
  },
  stepConditionBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stepConditionText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  stepTemp: {
    color: '#eab308',
    fontSize: 11,
    fontWeight: '600',
  },
  noDirections: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noDirectionsText: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 12,
  },
  alertsTab: {},
  alertCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  alertExtreme: {
    backgroundColor: '#7f1d1d',
  },
  alertHigh: {
    backgroundColor: '#991b1b',
  },
  alertMedium: {
    backgroundColor: '#78350f',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  alertInfo: {
    flex: 1,
  },
  alertCountdown: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  alertMessage: {
    color: '#fecaca',
    fontSize: 12,
    marginTop: 2,
  },
  alertAction: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  alertRec: {
    color: '#bbf7d0',
    fontSize: 12,
    flex: 1,
  },
  alertMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  alertDistance: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },
  alertEta: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },
  noAlerts: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noAlertsTitle: {
    color: '#22c55e',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
  },
  noAlertsText: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 4,
  },
  bottomPadding: {
    height: 100,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#27272a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#3f3f46',
  },
  actionBtn: {
    alignItems: 'center',
    padding: 8,
  },
  actionText: {
    color: '#a1a1aa',
    fontSize: 11,
    marginTop: 4,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    gap: 8,
  },
  navText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  // Radar Map styles
  radarBtn: {
    padding: 8,
    marginRight: 4,
  },
  radarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  radarModalContent: {
    flex: 1,
    backgroundColor: '#18181b',
  },
  radarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#27272a',
    borderBottomWidth: 1,
    borderBottomColor: '#3f3f46',
  },
  radarHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radarTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  radarWebView: {
    flex: 1,
  },
  // Chat styles
  chatFab: {
    position: 'absolute',
    right: 20,
    bottom: 100,
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
    height: '75%',
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
    paddingVertical: 30,
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
  listeningIndicator: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  listeningText: {
    color: '#fecaca',
    fontSize: 14,
    fontWeight: '600',
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
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
  },
  micBtnActive: {
    backgroundColor: '#7f1d1d',
  },
});
