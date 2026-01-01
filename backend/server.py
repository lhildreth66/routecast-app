from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
import httpx
import polyline
from openai import AsyncOpenAI
import asyncio
import math

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# API Keys
MAPBOX_ACCESS_TOKEN = os.environ.get('MAPBOX_ACCESS_TOKEN', '')
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# Configure OpenAI client with Emergent LLM key
openai_client = AsyncOpenAI(
    api_key=EMERGENT_LLM_KEY,
    base_url="https://api.emergentagi.com/v1"
)

# NOAA API Headers
NOAA_HEADERS = {
    'User-Agent': 'HawkeyeDevWeather/1.0 (lisaannehildreth@gmail.com)',
    'Accept': 'application/geo+json'
}

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== Models ====================

class RouteRequest(BaseModel):
    origin: str
    destination: str

class Waypoint(BaseModel):
    lat: float
    lon: float
    name: Optional[str] = None
    distance_from_start: Optional[float] = None  # in miles

class WeatherData(BaseModel):
    temperature: Optional[int] = None
    temperature_unit: Optional[str] = "F"
    wind_speed: Optional[str] = None
    wind_direction: Optional[str] = None
    conditions: Optional[str] = None
    icon: Optional[str] = None
    humidity: Optional[int] = None
    is_daytime: Optional[bool] = True

class WeatherAlert(BaseModel):
    id: str
    headline: str
    severity: str
    event: str
    description: str
    areas: Optional[str] = None

class WaypointWeather(BaseModel):
    waypoint: Waypoint
    weather: Optional[WeatherData] = None
    alerts: List[WeatherAlert] = []
    error: Optional[str] = None

class RouteWeatherResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    origin: str
    destination: str
    route_geometry: str  # Encoded polyline
    waypoints: List[WaypointWeather]
    ai_summary: Optional[str] = None
    has_severe_weather: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

class SavedRoute(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    origin: str
    destination: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

# ==================== Helper Functions ====================

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in miles."""
    R = 3959  # Earth's radius in miles
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c

def extract_waypoints_from_route(encoded_polyline: str, interval_miles: float = 50) -> List[Waypoint]:
    """Extract waypoints along route at specified intervals."""
    try:
        coords = polyline.decode(encoded_polyline)
        if not coords:
            return []
        
        waypoints = []
        total_distance = 0.0
        last_waypoint_distance = 0.0
        
        # Always include start point
        waypoints.append(Waypoint(
            lat=coords[0][0],
            lon=coords[0][1],
            name="Start",
            distance_from_start=0
        ))
        
        for i in range(1, len(coords)):
            lat1, lon1 = coords[i-1]
            lat2, lon2 = coords[i]
            segment_distance = haversine_distance(lat1, lon1, lat2, lon2)
            total_distance += segment_distance
            
            # Add waypoint if we've traveled enough distance
            if total_distance - last_waypoint_distance >= interval_miles:
                waypoints.append(Waypoint(
                    lat=lat2,
                    lon=lon2,
                    name=f"Mile {int(total_distance)}",
                    distance_from_start=round(total_distance, 1)
                ))
                last_waypoint_distance = total_distance
        
        # Always include end point if it's not too close to last waypoint
        end_lat, end_lon = coords[-1]
        if len(waypoints) == 1 or haversine_distance(
            waypoints[-1].lat, waypoints[-1].lon, end_lat, end_lon
        ) > 10:
            waypoints.append(Waypoint(
                lat=end_lat,
                lon=end_lon,
                name="Destination",
                distance_from_start=round(total_distance, 1)
            ))
        
        return waypoints
    except Exception as e:
        logger.error(f"Error extracting waypoints: {e}")
        return []

async def geocode_location(location: str) -> Optional[Dict[str, float]]:
    """Geocode a location string to coordinates using Mapbox."""
    try:
        async with httpx.AsyncClient() as client:
            url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{location}.json"
            params = {
                'access_token': MAPBOX_ACCESS_TOKEN,
                'limit': 1,
                'country': 'US'
            }
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data.get('features') and len(data['features']) > 0:
                coords = data['features'][0]['center']
                return {'lon': coords[0], 'lat': coords[1]}
    except Exception as e:
        logger.error(f"Geocoding error for {location}: {e}")
    return None

async def get_mapbox_route(origin_coords: Dict, dest_coords: Dict) -> Optional[str]:
    """Get route from Mapbox Directions API."""
    try:
        async with httpx.AsyncClient() as client:
            url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{origin_coords['lon']},{origin_coords['lat']};{dest_coords['lon']},{dest_coords['lat']}"
            params = {
                'access_token': MAPBOX_ACCESS_TOKEN,
                'geometries': 'polyline',
                'overview': 'full'
            }
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data.get('routes') and len(data['routes']) > 0:
                return data['routes'][0]['geometry']
    except Exception as e:
        logger.error(f"Mapbox route error: {e}")
    return None

async def get_noaa_weather(lat: float, lon: float) -> Optional[WeatherData]:
    """Get weather data from NOAA for a location."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # First get the grid point
            point_url = f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}"
            point_response = await client.get(point_url, headers=NOAA_HEADERS)
            
            if point_response.status_code != 200:
                logger.warning(f"NOAA points API error for {lat},{lon}: {point_response.status_code}")
                return None
            
            point_data = point_response.json()
            forecast_url = point_data.get('properties', {}).get('forecastHourly')
            
            if not forecast_url:
                return None
            
            # Get hourly forecast
            forecast_response = await client.get(forecast_url, headers=NOAA_HEADERS)
            
            if forecast_response.status_code != 200:
                logger.warning(f"NOAA forecast API error: {forecast_response.status_code}")
                return None
            
            forecast_data = forecast_response.json()
            periods = forecast_data.get('properties', {}).get('periods', [])
            
            if periods:
                current = periods[0]
                return WeatherData(
                    temperature=current.get('temperature'),
                    temperature_unit=current.get('temperatureUnit', 'F'),
                    wind_speed=current.get('windSpeed'),
                    wind_direction=current.get('windDirection'),
                    conditions=current.get('shortForecast'),
                    icon=current.get('icon'),
                    humidity=current.get('relativeHumidity', {}).get('value'),
                    is_daytime=current.get('isDaytime', True)
                )
    except Exception as e:
        logger.error(f"NOAA weather error for {lat},{lon}: {e}")
    return None

async def get_noaa_alerts(lat: float, lon: float) -> List[WeatherAlert]:
    """Get weather alerts from NOAA for a location."""
    alerts = []
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"https://api.weather.gov/alerts?point={lat:.4f},{lon:.4f}"
            response = await client.get(url, headers=NOAA_HEADERS)
            
            if response.status_code == 200:
                data = response.json()
                features = data.get('features', [])
                
                for feature in features[:5]:  # Limit to 5 alerts
                    props = feature.get('properties', {})
                    alerts.append(WeatherAlert(
                        id=props.get('id', str(uuid.uuid4())),
                        headline=props.get('headline', 'Weather Alert'),
                        severity=props.get('severity', 'Unknown'),
                        event=props.get('event', 'Weather Event'),
                        description=props.get('description', '')[:500],
                        areas=props.get('areaDesc')
                    ))
    except Exception as e:
        logger.error(f"NOAA alerts error for {lat},{lon}: {e}")
    return alerts

async def generate_ai_summary(waypoints_weather: List[WaypointWeather], origin: str, destination: str) -> str:
    """Generate AI-powered weather summary using Gemini Flash via Emergent."""
    try:
        # Build weather context
        weather_info = []
        all_alerts = []
        
        for wp in waypoints_weather:
            if wp.weather:
                info = f"- {wp.waypoint.name} ({wp.waypoint.distance_from_start} mi): "
                info += f"{wp.weather.temperature}°{wp.weather.temperature_unit}, "
                info += f"{wp.weather.conditions}, Wind: {wp.weather.wind_speed} {wp.weather.wind_direction}"
                weather_info.append(info)
            
            for alert in wp.alerts:
                all_alerts.append(f"- {alert.event}: {alert.headline}")
        
        weather_text = "\n".join(weather_info) if weather_info else "No weather data available"
        alerts_text = "\n".join(set(all_alerts)) if all_alerts else "No active alerts"
        
        prompt = f"""You are a helpful travel weather assistant. Provide a brief, driver-friendly weather summary for a road trip.

Route: {origin} to {destination}

Weather along route:
{weather_text}

Active Alerts:
{alerts_text}

Provide a 2-3 sentence summary focusing on:
1. Overall driving conditions
2. Any weather concerns or hazards
3. Recommendations for the driver

Be concise and practical."""

        response = await openai_client.chat.completions.create(
            model="gemini-2.0-flash",
            messages=[
                {"role": "system", "content": "You are a helpful travel weather assistant providing concise, driver-friendly weather summaries."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=300,
            temperature=0.7
        )
        
        return response.choices[0].message.content if response.choices else "Unable to generate summary."
    except Exception as e:
        logger.error(f"AI summary error: {e}")
        return f"Weather summary unavailable. Check individual waypoints for conditions."

# ==================== API Routes ====================

@api_router.get("/")
async def root():
    return {"message": "Weather Route API", "version": "1.0"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@api_router.post("/route/weather", response_model=RouteWeatherResponse)
async def get_route_weather(request: RouteRequest):
    """Get weather along a route from origin to destination."""
    logger.info(f"Route weather request: {request.origin} -> {request.destination}")
    
    # Geocode origin and destination
    origin_coords = await geocode_location(request.origin)
    if not origin_coords:
        raise HTTPException(status_code=400, detail=f"Could not geocode origin: {request.origin}")
    
    dest_coords = await geocode_location(request.destination)
    if not dest_coords:
        raise HTTPException(status_code=400, detail=f"Could not geocode destination: {request.destination}")
    
    # Get route from Mapbox
    route_geometry = await get_mapbox_route(origin_coords, dest_coords)
    if not route_geometry:
        raise HTTPException(status_code=500, detail="Could not get route from Mapbox")
    
    # Extract waypoints along route
    waypoints = extract_waypoints_from_route(route_geometry, interval_miles=50)
    if not waypoints:
        raise HTTPException(status_code=500, detail="Could not extract waypoints from route")
    
    # Get weather for each waypoint (with concurrent requests)
    waypoints_weather = []
    has_severe = False
    
    async def fetch_waypoint_weather(wp: Waypoint) -> WaypointWeather:
        nonlocal has_severe
        weather = await get_noaa_weather(wp.lat, wp.lon)
        alerts = await get_noaa_alerts(wp.lat, wp.lon)
        
        # Check for severe weather
        severe_severities = ['Extreme', 'Severe']
        if any(a.severity in severe_severities for a in alerts):
            has_severe = True
        
        return WaypointWeather(
            waypoint=wp,
            weather=weather,
            alerts=alerts
        )
    
    # Fetch weather concurrently but with some rate limiting
    tasks = [fetch_waypoint_weather(wp) for wp in waypoints]
    waypoints_weather = await asyncio.gather(*tasks)
    
    # Generate AI summary
    ai_summary = await generate_ai_summary(list(waypoints_weather), request.origin, request.destination)
    
    response = RouteWeatherResponse(
        origin=request.origin,
        destination=request.destination,
        route_geometry=route_geometry,
        waypoints=list(waypoints_weather),
        ai_summary=ai_summary,
        has_severe_weather=has_severe
    )
    
    # Save to database
    try:
        await db.routes.insert_one(response.model_dump())
    except Exception as e:
        logger.error(f"Error saving route: {e}")
    
    return response

@api_router.get("/routes/history", response_model=List[SavedRoute])
async def get_route_history():
    """Get recent route history."""
    try:
        routes = await db.routes.find().sort("created_at", -1).limit(10).to_list(10)
        return [SavedRoute(
            id=str(r.get('_id', r.get('id'))),
            origin=r['origin'],
            destination=r['destination'],
            created_at=r.get('created_at', datetime.utcnow())
        ) for r in routes]
    except Exception as e:
        logger.error(f"Error fetching route history: {e}")
        return []

@api_router.get("/routes/{route_id}", response_model=RouteWeatherResponse)
async def get_route_by_id(route_id: str):
    """Get a specific route by ID."""
    try:
        route = await db.routes.find_one({"id": route_id})
        if not route:
            raise HTTPException(status_code=404, detail="Route not found")
        return RouteWeatherResponse(**route)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching route {route_id}: {e}")
        raise HTTPException(status_code=500, detail="Error fetching route")

@api_router.post("/geocode")
async def geocode(location: str):
    """Geocode a location string."""
    coords = await geocode_location(location)
    if not coords:
        raise HTTPException(status_code=404, detail="Location not found")
    return coords

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
