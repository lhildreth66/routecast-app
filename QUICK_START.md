# Routecast Quick Start Guide

## 🚨 IMPORTANT: You Need BOTH Backend AND Frontend Running!

The app won't work without the backend server. You're getting "network error" because the backend isn't running.

---

## Step 1: Start the Backend Server

### First Time Setup (One Time Only):

1. **Navigate to backend folder:**
   ```bash
   cd C:\Users\bestg\projects\routecast-app\backend
   ```

2. **Check if `.env` file exists:**
   - If not, create one with your MongoDB URL, Mapbox token, and OpenAI key
   - See `.env.example` for reference

3. **Install dependencies (if needed):**
   ```bash
   pip install -r requirements.txt
   ```

### Start Backend Every Time:

**Option A: Use the start script (Easiest)**
```bash
cd C:\Users\bestg\projects\routecast-app\backend
start.bat
```

**Option B: Manual start**
```bash
cd C:\Users\bestg\projects\routecast-app\backend
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

✅ **Backend should now be running on** `http://localhost:8000`

---

## Step 2: Start the Frontend

### In a NEW terminal window:

1. **Navigate to frontend folder:**
   ```bash
   cd C:\Users\bestg\projects\routecast-app\frontend
   ```

2. **Start Expo:**
   ```bash
   npx expo start
   ```

3. **Open the app:**
   - **Physical Device:** Scan QR code with Expo Go app
   - **Android Emulator:** Press `a` in the terminal

---

## Current Configuration

### For Local Testing (Current `.env` settings):
- **Your Computer IP:** `192.168.1.121`
- **Backend URL:** `http://192.168.1.121:8000`
- **Works with:** Physical devices on same WiFi network

### For Emulator Testing:
- Change `.env` to use: `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000`

### For Production Play Store Build:
- Already configured in `eas.json` to use: `https://routecast-backend.onrender.com`
- **NOTE:** You need to fix your Render.com deployment first!

---

## Troubleshooting

### "Network Error" in App

**Problem:** Backend server isn't running or app can't reach it.

**Solution:**
1. Check backend is running: Open `http://localhost:8000/docs` in your browser
2. If you see API docs page, backend is working!
3. If not, start the backend using Step 1 above

### "Can't connect from physical device"

**Problem:** Phone can't reach your computer.

**Solution:**
1. Make sure phone and computer are on the SAME WiFi network
2. Check your IP hasn't changed: `ipconfig | findstr IPv4`
3. Update `.env` if IP changed
4. Restart Expo with: `npx expo start --clear`

### "Autocomplete not working"

**Problem:** Either network error OR Mapbox token issue.

**Solution:**
1. First fix backend connection (see above)
2. If backend works but autocomplete doesn't, check Mapbox token in `.env`

---

## Building for Play Store

**IMPORTANT:** Before building for Play Store:

1. **Fix your Render.com backend deployment** - it's currently returning 404 errors
   - Check your Render.com dashboard
   - Make sure the backend is deployed and running
   - Test it: `https://routecast-backend.onrender.com/docs`

2. **Build the app:**
   ```bash
   cd frontend
   eas build --platform android --profile production
   ```

3. **Submit to Play Store:**
   ```bash
   eas submit --platform android --profile production
   ```

The production build will automatically use `https://routecast-backend.onrender.com` (configured in `eas.json`).

---

## Quick Reference

| Scenario | Backend URL | How to Set |
|----------|-------------|------------|
| **Physical Device (Current)** | `http://192.168.1.121:8000` | Already set in `.env` |
| **Android Emulator** | `http://10.0.2.2:8000` | Change in `.env` |
| **Play Store Build** | `https://routecast-backend.onrender.com` | Already set in `eas.json` |

---

## Need Help?

1. ✅ Backend running? Check `http://localhost:8000/docs`
2. ✅ Frontend running? Check Expo terminal shows QR code
3. ✅ Same WiFi? Phone and computer must be on same network
4. ✅ Correct IP? Run `ipconfig` and update `.env` if changed
