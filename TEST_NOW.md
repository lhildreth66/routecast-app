# Test App RIGHT NOW (Local Development)

Use this to test the app on your phone while you fix the Render.com deployment.

## Quick Test - 3 Steps

### Step 1: Start Backend (Terminal 1)

```bash
cd C:\Users\bestg\projects\routecast-app\backend
start.bat
```

✅ Keep this terminal open! Backend must stay running.

### Step 2: Start Frontend (Terminal 2)

```bash
cd C:\Users\bestg\projects\routecast-app\frontend
npx expo start
```

### Step 3: Open on Phone

1. **Install Expo Go** app from Play Store (if not installed)
2. **Make sure phone is on same WiFi as your computer**
3. **Scan QR code** shown in the terminal

✅ App should work now!

---

## If You Get Network Error

### Check Backend is Running
Open in your browser: http://localhost:8000/docs

- ✅ **See API docs?** Backend is working!
- ❌ **Can't connect?** Backend not running - go back to Step 1

### Check WiFi
- Phone and computer MUST be on the same WiFi network
- Public WiFi (hotels, cafes) often blocks this

### Check IP Address
Your current IP in `.env` is: **192.168.1.121**

If it changed:
1. Run: `ipconfig | findstr IPv4`
2. Update `.env` file with new IP
3. Restart: `npx expo start --clear`

---

## This is ONLY for Testing!

⚠️ **Important:** This setup only works while:
- Your computer is on
- Backend server is running
- Phone is on your WiFi

**For Play Store users to work, you MUST deploy backend to Render.com** (see DEPLOY_BACKEND.md)

---

## Current Configuration

| File | What It Does | Current Value |
|------|-------------|---------------|
| `frontend/.env` | Local development URL | `http://192.168.1.121:8000` |
| `frontend/eas.json` | Play Store production URL | `https://routecast-backend.onrender.com` |

- ✅ Local testing: Uses `.env` (your computer)
- ✅ Play Store: Uses `eas.json` (Render.com)

---

## Summary

**Right now:**
- ✅ You can test locally following steps above
- ❌ Play Store downloads won't work until backend is deployed

**To fix Play Store:**
1. Deploy backend to Render.com (see DEPLOY_BACKEND.md)
2. Build new app version: `eas build --platform android --profile production`
3. Upload to Play Store

**Files are already configured correctly!** You just need to deploy the backend.
