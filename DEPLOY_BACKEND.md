# Deploy Backend to Render.com

## Why You Need This
Your Play Store app is trying to connect to `https://routecast-backend.onrender.com` but it's returning 404 errors. You need to deploy your backend there.

## Step-by-Step Deployment

### 1. Go to Render.com
1. Go to https://render.com
2. Log in to your account (or create one if needed)

### 2. Create New Web Service
1. Click **"New +"** button
2. Select **"Web Service"**
3. Connect your GitHub repository (or deploy from this directory)

### 3. Configure Service

**Basic Settings:**
- **Name:** `routecast-backend`
- **Region:** Choose closest to your users
- **Branch:** `main` (or your production branch)
- **Root Directory:** `backend` (if your repo has backend folder)
- **Runtime:** `Python 3`

**Build Settings:**
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn server:app --host 0.0.0.0 --port $PORT`

### 4. Set Environment Variables

Click **"Advanced"** and add these environment variables:

```
MONGO_URL=your_mongodb_connection_string
DB_NAME=routecast
MAPBOX_ACCESS_TOKEN=pk.eyJ1IjoibWVkdHJhbjAxIiwiYSI6ImNtanVxZzdubDVmaTYzZXB1OXQycWZocHgifQ.j5RSdKtu-2Mc6Dm0f8HInQ
EMERGENT_LLM_KEY=your_openai_or_emergent_key
```

**Important:** You'll need a MongoDB database. Options:
- **MongoDB Atlas** (free tier): https://www.mongodb.com/cloud/atlas
- Or use another MongoDB host

### 5. Deploy
1. Click **"Create Web Service"**
2. Wait for deployment (5-10 minutes)
3. Render will give you a URL like: `https://routecast-backend.onrender.com`

### 6. Test Deployment

Open your browser to:
```
https://routecast-backend.onrender.com/docs
```

You should see the FastAPI documentation page. If you see this, **IT WORKS!** ✅

### 7. Update Frontend (Already Done!)

The frontend is already configured in `eas.json` to use:
```json
"env": {
  "EXPO_PUBLIC_API_URL": "https://routecast-backend.onrender.com"
}
```

### 8. Rebuild App for Play Store

```bash
cd frontend
eas build --platform android --profile production
```

Then submit the new build to Google Play Store.

---

## Option 2: Use Different Backend Host

If you don't want to use Render.com, you can deploy to:

### **Railway.app** (Easy)
- Similar to Render
- Go to https://railway.app
- Deploy from GitHub
- Set same environment variables

### **Heroku** (Popular)
- Go to https://heroku.com
- Create app, deploy from GitHub
- Add MongoDB add-on

### **Your Own Server** (Advanced)
- Deploy to AWS, DigitalOcean, etc.
- Must have HTTPS certificate
- Update `eas.json` with your URL

---

## After Backend is Live

### Test the Backend
```bash
# Should return API docs
curl https://your-backend-url.com/docs

# Test route weather endpoint
curl -X POST https://your-backend-url.com/api/route/weather \
  -H "Content-Type: application/json" \
  -d '{"origin":"New York, NY","destination":"Boston, MA"}'
```

### Update App Build
1. Update version in `app.json`: `"versionCode": 4`
2. Build: `eas build --platform android --profile production`
3. Submit: `eas submit --platform android`

---

## Troubleshooting

### Backend Shows 404
- Check the **Start Command** is correct: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Check the **Root Directory** points to where `server.py` is located
- Check **Build logs** in Render dashboard

### Backend Shows 500 Error
- Missing environment variables (MONGO_URL, etc.)
- Check **Logs** in Render dashboard
- MongoDB connection failing

### App Still Shows Network Error
- Wait 5 minutes for build to fully deploy
- Clear app cache and reinstall from Play Store
- Check you built with `--profile production`

---

## Current Status

✅ Frontend configured correctly  
✅ `eas.json` has production URL  
❌ Backend not deployed to Render  
❌ Play Store app can't connect  

**Next Step:** Deploy backend to Render.com following steps above!
