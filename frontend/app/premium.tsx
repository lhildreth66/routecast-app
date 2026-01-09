import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREMIUM_KEY = "routecast_premium_status";

export default function PremiumScreen() {
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly">("yearly");

  const handleSubscribe = async () => {
    // TODO: Integrate with PayPal
    Alert.alert(
      "Subscribe to Routecast Pro",
      "PayPal integration coming soon! For now, this is a demo.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Enable Pro (Demo)",
          onPress: async () => {
            await AsyncStorage.setItem(PREMIUM_KEY, JSON.stringify({
              isPremium: true,
              plan: selectedPlan,
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            }));
            Alert.alert("Success!", "Routecast Pro activated!");
            router.back();
          },
        },
      ]
    );
  };

  const features = [
    { icon: "🎯", title: "Delay Risk Score", description: "AI-powered delay predictions" },
    { icon: "⏰", title: "Drive Window Advisor", description: "Optimal departure time recommendations" },
    { icon: "🛣️", title: "Weather-Based Re-Routing", description: "Safest route alternatives" },
    { icon: "🎤", title: "Voice Weather Alerts", description: "Hands-free driving updates" },
    { icon: "⛽", title: "Fuel Stop Optimizer", description: "Smart refueling suggestions" },
    { icon: "📍", title: "Rest Stop Weather", description: "Conditions at upcoming stops" },
    { icon: "💾", title: "Unlimited Saved Routes", description: "No limit on favorites" },
    { icon: "🚛", title: "Commercial Features", description: "Wind warnings, weight restrictions" },
    { icon: "⛓️", title: "Chain Alerts", description: "Mountain pass requirements" },
    { icon: "📊", title: "Trip History", description: "Past routes with weather logs" },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>✕</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Routecast Pro</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>⚡</Text>
          <Text style={styles.heroTitle}>Unlock Premium Features</Text>
          <Text style={styles.heroSubtitle}>
            Get AI-powered insights, advanced routing, and professional tools
          </Text>
        </View>

        <View style={styles.planSelector}>
          <Pressable
            style={[styles.planCard, selectedPlan === "yearly" && styles.planCardActive]}
            onPress={() => setSelectedPlan("yearly")}
          >
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>BEST VALUE</Text>
            </View>
            <Text style={styles.planTitle}>Yearly</Text>
            <Text style={styles.planPrice}>$39.99</Text>
            <Text style={styles.planPeriod}>per year</Text>
            <Text style={styles.planSavings}>Save 33%</Text>
          </Pressable>

          <Pressable
            style={[styles.planCard, selectedPlan === "monthly" && styles.planCardActive]}
            onPress={() => setSelectedPlan("monthly")}
          >
            <Text style={styles.planTitle}>Monthly</Text>
            <Text style={styles.planPrice}>$4.99</Text>
            <Text style={styles.planPeriod}>per month</Text>
          </Pressable>
        </View>

        <View style={styles.featuresSection}>
          <Text style={styles.featuresTitle}>What's Included</Text>
          {features.map((feature, idx) => (
            <View key={idx} style={styles.featureItem}>
              <Text style={styles.featureIcon}>{feature.icon}</Text>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable style={styles.subscribeBtn} onPress={handleSubscribe}>
          <Text style={styles.subscribeBtnText}>
            Subscribe - {selectedPlan === "yearly" ? "$39.99/year" : "$4.99/month"}
          </Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          Cancel anytime. By subscribing, you agree to automatic renewal through PayPal.
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  backText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  headerTitle: { color: "#facc15", fontSize: 18, fontWeight: "900" },
  content: { padding: 20 },
  hero: { alignItems: "center", marginBottom: 32 },
  heroIcon: { fontSize: 60, marginBottom: 16 },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "900", marginBottom: 8, textAlign: "center" },
  heroSubtitle: { color: "rgba(255,255,255,0.7)", fontSize: 16, textAlign: "center", paddingHorizontal: 20 },
  planSelector: { flexDirection: "row", gap: 12, marginBottom: 32 },
  planCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
  },
  planCardActive: {
    borderColor: "#facc15",
    backgroundColor: "rgba(250,204,21,0.1)",
  },
  planBadge: {
    position: "absolute",
    top: -10,
    backgroundColor: "#facc15",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  planBadgeText: { color: "#0a0a0a", fontSize: 10, fontWeight: "900" },
  planTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 8 },
  planPrice: { color: "#facc15", fontSize: 32, fontWeight: "900" },
  planPeriod: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 4 },
  planSavings: { color: "#4ade80", fontSize: 14, fontWeight: "700", marginTop: 8 },
  featuresSection: { marginBottom: 24 },
  featuresTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 16 },
  featureItem: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  featureIcon: { fontSize: 24, marginRight: 12 },
  featureText: { flex: 1 },
  featureTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 2 },
  featureDescription: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
  subscribeBtn: {
    backgroundColor: "#facc15",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    marginBottom: 16,
  },
  subscribeBtnText: { color: "#0a0a0a", fontSize: 18, fontWeight: "900" },
  disclaimer: { color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center", paddingHorizontal: 20 },
});
