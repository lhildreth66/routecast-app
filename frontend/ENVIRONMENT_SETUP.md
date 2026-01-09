# Environment Setup Guide

## Overview
The app can connect to different backend servers depending on your needs:
- **Production Backend**: `https://routecast-backend.onrender.com` (for Play Store builds)
- **Local Backend**: Your local development server (for testing)

## Current Configuration

### For Play Store Builds (Production)
The app is configured to use the production backend automatically via `eas.json`:
- ✅ Already configured for production builds
- ✅ Will work on any device that downloads from Play Store

### For Local Development

#### Option 1: Test with Production Backend (Recommended)
The default `.env` file now points to production:
```bash
# .env (current default)
EXPO_PUBLIC_API_URL=https://routecast-backend.onrender.com
```

This means:
- Run `npx expo start` and scan QR code
- App will connect to production backend
- Works on emulator, physical devices, and Play Store

#### Option 2: Test with Local Backend
If you want to test with your local backend server:

1. **Copy the local environment file:**
   ```bash
   cp .env.local .env
   ```

2. **For Physical Devices** (not emulator), update `.env` with your computer's IP:
   - Find your IP: `ipconfig` (look for IPv4 Address)
   - Update `.env`:
     ```
     EXPO_PUBLIC_API_URL=http://YOUR_IP_ADDRESS:8000
     ```
     (e.g., `http://192.168.1.100:8000`)

3. **For Android Emulator**, use:
   ```
   EXPO_PUBLIC_API_URL=http://10.0.2.2:8000
   ```

4. **Restart Expo**:
   ```bash
   npx expo start --clear
   ```

## Building for Play Store

To build a new version for the Play Store:

```bash
# Build production APK/AAB (version 3)
eas build --platform android --profile production

# After successful build, submit to Play Store
eas submit --platform android --profile production
```

The production build will automatically use `https://routecast-backend.onrender.com`.

## Troubleshooting

### "Network Error" on Physical Device
- Make sure `.env` has the production URL: `https://routecast-backend.onrender.com`
- If using local backend, ensure your phone and computer are on the same WiFi network
- Restart the app after changing `.env`

### "Network Error" on Play Store Version
- Check that your backend server is running: `https://routecast-backend.onrender.com`
- Verify the app was built with the production profile
- Current Play Store version should be versionCode 3+

### Autocomplete Not Working
- Same as network errors - check backend connectivity
- Mapbox autocomplete calls are separate and should work if they're failing too

## Quick Reference

| Scenario | Environment File | Backend URL |
|----------|-----------------|-------------|
| Play Store Build | `eas.json` | `https://routecast-backend.onrender.com` |
| Local Testing (Production) | `.env` | `https://routecast-backend.onrender.com` |
| Local Testing (Dev Server) | `.env.local` → `.env` | `http://10.0.2.2:8000` or your IP |
