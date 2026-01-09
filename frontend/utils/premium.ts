import AsyncStorage from "@react-native-async-storage/async-storage";

const PREMIUM_KEY = "routecast_premium_status";

export type PremiumStatus = {
  isPremium: boolean;
  plan?: "monthly" | "yearly";
  expiresAt?: string;
};

export async function getPremiumStatus(): Promise<PremiumStatus> {
  try {
    const data = await AsyncStorage.getItem(PREMIUM_KEY);
    if (!data) return { isPremium: false };
    
    const status: PremiumStatus = JSON.parse(data);
    
    // Check if expired
    if (status.expiresAt) {
      const expiryDate = new Date(status.expiresAt);
      if (expiryDate < new Date()) {
        return { isPremium: false };
      }
    }
    
    return status;
  } catch {
    return { isPremium: false };
  }
}

export async function setPremiumStatus(status: PremiumStatus): Promise<void> {
  try {
    await AsyncStorage.setItem(PREMIUM_KEY, JSON.stringify(status));
  } catch (error) {
    console.error("Failed to save premium status:", error);
  }
}

export async function clearPremiumStatus(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREMIUM_KEY);
  } catch (error) {
    console.error("Failed to clear premium status:", error);
  }
}
