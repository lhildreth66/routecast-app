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
from datetime import datetime, timedelta
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

# Vehicle types for safety scoring
VEHICLE_TYPES = {
    "car": {"wind_sensitivity": 1.0, "ice_sensitivity": 1.0, "visibility_sensitivity": 1.0, "name": "Car/Sedan"},
    "suv": {"wind_sensitivity": 1.1, "ice_sensitivity": 0.9, "visibility_sensitivity": 1.0, "name": "SUV"},
    "truck": {"wind_sensitivity": 1.3, "ice_sensitivity": 0.85, "visibility_sensitivity": 1.0, "name": "Pickup Truck"},
    "semi": {"wind_sensitivity": 1.8, "ice_sensitivity": 1.2, "visibility_sensitivity": 1.3, "name": "Semi Truck"},
    "rv": {"wind_sensitivity": 1.7, "ice_sensitivity": 1.1, "visibility_sensitivity": 1.2, "name": "RV/Motorhome"},
    "motorcycle": {"wind_sensitivity": 2.0, "ice_sensitivity": 2.5, "visibility_sensitivity": 1.5, "name": "Motorcycle"},
    "trailer": {"wind_sensitivity": 1.6, "ice_sensitivity": 1.3, "visibility_sensitivity": 1.1, "name": "Vehicle + Trailer"},
}

class StopPoint(BaseModel):
    location: str
    type: str = "stop"  # stop, gas, food, rest

class RouteRequest(BaseModel):
    origin: str
    destination: str
    departure_time: Optional[str] = None  # ISO format datetime
    stops: Optional[List[StopPoint]] = []
    vehicle_type: Optional[str] = "car"  # car, suv, truck, semi, rv, motorcycle, trailer
    trucker_mode: Optional[bool] = False  # Enable trucker-specific warnings
    vehicle_height_ft: Optional[float] = None  # Vehicle height in feet for clearance warnings

class HazardAlert(BaseModel):
    type: str  # wind, ice, visibility, rain, snow, etc.
    severity: str  # low, medium, high, extreme
    distance_miles: float
    eta_minutes: int
    message: str
    recommendation: str
    countdown_text: str  # "Heavy rain in 27 minutes"

class RestStop(BaseModel):
    name: str
    type: str  # gas, food, rest_area
    lat: float
    lon: float
    distance_miles: float
    eta_minutes: int
    weather_at_arrival: Optional[str] = None
    temperature_at_arrival: Optional[int] = None
    recommendation: str  # "Good time to stop - rain clears"

class DepartureWindow(BaseModel):
    departure_time: str
    arrival_time: str
    safety_score: int
    hazard_count: int
    recommendation: str
    conditions_summary: str

class SafetyScore(BaseModel):
    overall_score: int  # 0-100
    risk_level: str  # low, moderate, high, extreme
    vehicle_type: str
    factors: List[str]  # List of contributing factors
    recommendations: List[str]

class Waypoint(BaseModel):
    lat: float
    lon: float
    name: Optional[str] = None
    distance_from_start: Optional[float] = None  # in miles
    eta_minutes: Optional[int] = None  # minutes from departure
    arrival_time: Optional[str] = None  # ISO format

class HourlyForecast(BaseModel):
    time: str
    temperature: int
    conditions: str
    wind_speed: str
    precipitation_chance: Optional[int] = None

class WeatherData(BaseModel):
    temperature: Optional[int] = None
    temperature_unit: Optional[str] = "F"
    wind_speed: Optional[str] = None
    wind_direction: Optional[str] = None
    conditions: Optional[str] = None
    icon: Optional[str] = None
    humidity: Optional[int] = None
    is_daytime: Optional[bool] = True
    sunrise: Optional[str] = None
    sunset: Optional[str] = None
    hourly_forecast: Optional[List[HourlyForecast]] = []

class WeatherAlert(BaseModel):
    id: str
    headline: str
    severity: str
    event: str
    description: str
    areas: Optional[str] = None

class PackingSuggestion(BaseModel):
    item: str
    reason: str
    priority: str  # essential, recommended, optional

class WaypointWeather(BaseModel):
    waypoint: Waypoint
    weather: Optional[WeatherData] = None
    alerts: List[WeatherAlert] = []
    error: Optional[str] = None

class RouteWeatherResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    origin: str
    destination: str
    stops: List[StopPoint] = []
    departure_time: Optional[str] = None
    total_duration_minutes: Optional[int] = None
    route_geometry: str  # Encoded polyline
    waypoints: List[WaypointWeather]
    ai_summary: Optional[str] = None
    has_severe_weather: bool = False
    packing_suggestions: List[PackingSuggestion] = []
    weather_timeline: List[HourlyForecast] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_favorite: bool = False

class SavedRoute(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    origin: str
    destination: str
    stops: List[StopPoint] = []
    is_favorite: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

class FavoriteRouteRequest(BaseModel):
    origin: str
    destination: str
    stops: Optional[List[StopPoint]] = []
    name: Optional[str] = None

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

def calculate_eta(distance_miles: float, avg_speed_mph: float = 55) -> int:
    """Calculate ETA in minutes."""
    return int((distance_miles / avg_speed_mph) * 60)

def extract_waypoints_from_route(encoded_polyline: str, interval_miles: float = 50, departure_time: Optional[datetime] = None) -> List[Waypoint]:
    """Extract waypoints along route at specified intervals with ETAs."""
    try:
        coords = polyline.decode(encoded_polyline)
        if not coords:
            return []
        
        waypoints = []
        total_distance = 0.0
        last_waypoint_distance = 0.0
        
        dep_time = departure_time or datetime.now()
        
        # Always include start point
        waypoints.append(Waypoint(
            lat=coords[0][0],
            lon=coords[0][1],
            name="Start",
            distance_from_start=0,
            eta_minutes=0,
            arrival_time=dep_time.isoformat()
        ))
        
        for i in range(1, len(coords)):
            lat1, lon1 = coords[i-1]
            lat2, lon2 = coords[i]
            segment_distance = haversine_distance(lat1, lon1, lat2, lon2)
            total_distance += segment_distance
            
            # Add waypoint if we've traveled enough distance
            if total_distance - last_waypoint_distance >= interval_miles:
                eta_mins = calculate_eta(total_distance)
                arrival = dep_time + timedelta(minutes=eta_mins)
                waypoints.append(Waypoint(
                    lat=lat2,
                    lon=lon2,
                    name=f"Mile {int(total_distance)}",
                    distance_from_start=round(total_distance, 1),
                    eta_minutes=eta_mins,
                    arrival_time=arrival.isoformat()
                ))
                last_waypoint_distance = total_distance
        
        # Always include end point
        end_lat, end_lon = coords[-1]
        if len(waypoints) == 1 or haversine_distance(
            waypoints[-1].lat, waypoints[-1].lon, end_lat, end_lon
        ) > 10:
            eta_mins = calculate_eta(total_distance)
            arrival = dep_time + timedelta(minutes=eta_mins)
            waypoints.append(Waypoint(
                lat=end_lat,
                lon=end_lon,
                name="Destination",
                distance_from_start=round(total_distance, 1),
                eta_minutes=eta_mins,
                arrival_time=arrival.isoformat()
            ))
        
        return waypoints
    except Exception as e:
        logger.error(f"Error extracting waypoints: {e}")
        return []

async def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    """Reverse geocode coordinates to get city, state name."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{lon},{lat}.json"
            params = {
                'access_token': MAPBOX_ACCESS_TOKEN,
                'types': 'place,locality',
                'limit': 1
            }
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data.get('features') and len(data['features']) > 0:
                feature = data['features'][0]
                place_name = feature.get('text', '')
                
                # Extract state from context
                context = feature.get('context', [])
                state = ''
                for ctx in context:
                    if ctx.get('id', '').startswith('region'):
                        state = ctx.get('short_code', '').replace('US-', '')
                        break
                
                if place_name and state:
                    return f"{place_name}, {state}"
                return place_name or None
    except Exception as e:
        logger.error(f"Reverse geocoding error for {lat},{lon}: {e}")
    return None

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

async def get_mapbox_route(origin_coords: Dict, dest_coords: Dict, waypoints: List[Dict] = None) -> Optional[Dict]:
    """Get route from Mapbox Directions API with duration."""
    try:
        # Build coordinates string
        coords_list = [f"{origin_coords['lon']},{origin_coords['lat']}"]
        if waypoints:
            for wp in waypoints:
                coords_list.append(f"{wp['lon']},{wp['lat']}")
        coords_list.append(f"{dest_coords['lon']},{dest_coords['lat']}")
        coords_str = ";".join(coords_list)
        
        async with httpx.AsyncClient() as client:
            url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coords_str}"
            params = {
                'access_token': MAPBOX_ACCESS_TOKEN,
                'geometries': 'polyline',
                'overview': 'full'
            }
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data.get('routes') and len(data['routes']) > 0:
                route = data['routes'][0]
                return {
                    'geometry': route['geometry'],
                    'duration': route.get('duration', 0) / 60,  # Convert to minutes
                    'distance': route.get('distance', 0) / 1609.34  # Convert to miles
                }
    except Exception as e:
        logger.error(f"Mapbox route error: {e}")
    return None

async def get_noaa_weather(lat: float, lon: float) -> Optional[WeatherData]:
    """Get weather data from NOAA for a location with sunrise/sunset."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # First get the grid point
            point_url = f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}"
            point_response = await client.get(point_url, headers=NOAA_HEADERS)
            
            if point_response.status_code != 200:
                logger.warning(f"NOAA points API error for {lat},{lon}: {point_response.status_code}")
                return None
            
            point_data = point_response.json()
            props = point_data.get('properties', {})
            forecast_url = props.get('forecastHourly')
            
            if not forecast_url:
                return None
            
            # Get hourly forecast
            forecast_response = await client.get(forecast_url, headers=NOAA_HEADERS)
            
            if forecast_response.status_code != 200:
                logger.warning(f"NOAA forecast API error: {forecast_response.status_code}")
                return None
            
            forecast_data = forecast_response.json()
            periods = forecast_data.get('properties', {}).get('periods', [])
            
            # Get hourly forecasts for timeline
            hourly_forecast = []
            for period in periods[:12]:  # Next 12 hours
                hourly_forecast.append(HourlyForecast(
                    time=period.get('startTime', ''),
                    temperature=period.get('temperature', 0),
                    conditions=period.get('shortForecast', ''),
                    wind_speed=period.get('windSpeed', ''),
                    precipitation_chance=period.get('probabilityOfPrecipitation', {}).get('value')
                ))
            
            if periods:
                current = periods[0]
                
                # Calculate approximate sunrise/sunset based on time of day
                # This is simplified - in production, use a proper sun calculation library
                is_daytime = current.get('isDaytime', True)
                now = datetime.now()
                sunrise = now.replace(hour=6, minute=30).strftime("%I:%M %p")
                sunset = now.replace(hour=18, minute=30).strftime("%I:%M %p")
                
                return WeatherData(
                    temperature=current.get('temperature'),
                    temperature_unit=current.get('temperatureUnit', 'F'),
                    wind_speed=current.get('windSpeed'),
                    wind_direction=current.get('windDirection'),
                    conditions=current.get('shortForecast'),
                    icon=current.get('icon'),
                    humidity=current.get('relativeHumidity', {}).get('value'),
                    is_daytime=is_daytime,
                    sunrise=sunrise,
                    sunset=sunset,
                    hourly_forecast=hourly_forecast
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

def generate_packing_suggestions(waypoints_weather: List[WaypointWeather]) -> List[PackingSuggestion]:
    """Generate packing suggestions based on weather conditions."""
    suggestions = []
    
    temps = []
    has_rain = False
    has_snow = False
    has_wind = False
    has_sun = False
    
    for wp in waypoints_weather:
        if wp.weather:
            if wp.weather.temperature:
                temps.append(wp.weather.temperature)
            
            conditions = (wp.weather.conditions or '').lower()
            if 'rain' in conditions or 'shower' in conditions:
                has_rain = True
            if 'snow' in conditions or 'flurr' in conditions:
                has_snow = True
            if 'wind' in conditions:
                has_wind = True
            if 'sun' in conditions or 'clear' in conditions:
                has_sun = True
            
            # Check wind speed
            wind = wp.weather.wind_speed or ''
            if any(str(x) in wind for x in range(15, 50)):
                has_wind = True
    
    # Temperature-based suggestions
    if temps:
        min_temp = min(temps)
        max_temp = max(temps)
        
        if min_temp < 40:
            suggestions.append(PackingSuggestion(
                item="Warm jacket",
                reason=f"Temperatures as low as {min_temp}°F expected",
                priority="essential"
            ))
        if min_temp < 32:
            suggestions.append(PackingSuggestion(
                item="Gloves & hat",
                reason="Freezing temperatures along route",
                priority="essential"
            ))
        if max_temp > 85:
            suggestions.append(PackingSuggestion(
                item="Extra water",
                reason=f"High temperatures up to {max_temp}°F",
                priority="essential"
            ))
        if max_temp - min_temp > 20:
            suggestions.append(PackingSuggestion(
                item="Layers",
                reason=f"Temperature range of {max_temp - min_temp}°F",
                priority="recommended"
            ))
    
    # Condition-based suggestions
    if has_rain:
        suggestions.append(PackingSuggestion(
            item="Umbrella/rain jacket",
            reason="Rain expected along route",
            priority="essential"
        ))
    if has_snow:
        suggestions.append(PackingSuggestion(
            item="Snow gear & emergency kit",
            reason="Snow conditions expected",
            priority="essential"
        ))
    if has_wind:
        suggestions.append(PackingSuggestion(
            item="Windbreaker",
            reason="Windy conditions expected",
            priority="recommended"
        ))
    if has_sun:
        suggestions.append(PackingSuggestion(
            item="Sunglasses",
            reason="Sunny conditions expected",
            priority="recommended"
        ))
        suggestions.append(PackingSuggestion(
            item="Sunscreen",
            reason="Sun exposure during drive",
            priority="optional"
        ))
    
    # Always recommend
    suggestions.append(PackingSuggestion(
        item="Phone charger",
        reason="Keep devices charged for navigation",
        priority="essential"
    ))
    suggestions.append(PackingSuggestion(
        item="Snacks & water",
        reason="Stay hydrated and energized",
        priority="recommended"
    ))
    
    return suggestions[:8]  # Limit to 8 suggestions

def build_weather_timeline(waypoints_weather: List[WaypointWeather]) -> List[HourlyForecast]:
    """Build a combined weather timeline from all waypoints."""
    timeline = []
    seen_times = set()
    
    for wp in waypoints_weather:
        if wp.weather and wp.weather.hourly_forecast:
            for forecast in wp.weather.hourly_forecast[:4]:  # First 4 hours from each
                if forecast.time not in seen_times:
                    timeline.append(forecast)
                    seen_times.add(forecast.time)
    
    # Sort by time
    timeline.sort(key=lambda x: x.time)
    return timeline[:12]  # Return up to 12 hours

async def generate_ai_summary(waypoints_weather: List[WaypointWeather], origin: str, destination: str, packing: List[PackingSuggestion]) -> str:
    """Generate AI-powered weather summary using Gemini Flash."""
    try:
        # Build weather context
        weather_info = []
        all_alerts = []
        
        for wp in waypoints_weather:
            if wp.weather:
                info = f"- {wp.waypoint.name} ({wp.waypoint.distance_from_start} mi): "
                info += f"{wp.weather.temperature}°{wp.weather.temperature_unit}, "
                info += f"{wp.weather.conditions}, Wind: {wp.weather.wind_speed} {wp.weather.wind_direction}"
                if wp.waypoint.arrival_time:
                    info += f" (ETA: {wp.waypoint.arrival_time[:16]})"
                weather_info.append(info)
            
            for alert in wp.alerts:
                all_alerts.append(f"- {alert.event}: {alert.headline}")
        
        weather_text = "\n".join(weather_info) if weather_info else "No weather data available"
        alerts_text = "\n".join(set(all_alerts)) if all_alerts else "No active alerts"
        packing_text = ", ".join([p.item for p in packing[:5]]) if packing else "Standard travel items"
        
        prompt = f"""You are a helpful travel weather assistant. Provide a brief, driver-friendly weather summary for a road trip.

Route: {origin} to {destination}

Weather along route:
{weather_text}

Active Alerts:
{alerts_text}

Suggested packing: {packing_text}

Provide a 2-3 sentence summary focusing on:
1. Overall driving conditions
2. Any weather concerns or hazards
3. Key recommendations for the driver

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
    return {"message": "Routecast API", "version": "2.0", "features": ["departure_time", "multi_stop", "favorites", "packing_suggestions", "weather_timeline"]}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@api_router.post("/route/weather", response_model=RouteWeatherResponse)
async def get_route_weather(request: RouteRequest):
    """Get weather along a route from origin to destination."""
    logger.info(f"Route weather request: {request.origin} -> {request.destination}")
    
    # Parse departure time
    departure_time = None
    if request.departure_time:
        try:
            departure_time = datetime.fromisoformat(request.departure_time.replace('Z', '+00:00'))
        except:
            departure_time = datetime.now()
    else:
        departure_time = datetime.now()
    
    # Geocode origin and destination
    origin_coords = await geocode_location(request.origin)
    if not origin_coords:
        raise HTTPException(status_code=400, detail=f"Could not geocode origin: {request.origin}")
    
    dest_coords = await geocode_location(request.destination)
    if not dest_coords:
        raise HTTPException(status_code=400, detail=f"Could not geocode destination: {request.destination}")
    
    # Geocode stops if any
    stop_coords = []
    if request.stops:
        for stop in request.stops:
            coords = await geocode_location(stop.location)
            if coords:
                stop_coords.append(coords)
    
    # Get route from Mapbox
    route_data = await get_mapbox_route(origin_coords, dest_coords, stop_coords if stop_coords else None)
    if not route_data:
        raise HTTPException(status_code=500, detail="Could not get route from Mapbox")
    
    route_geometry = route_data['geometry']
    total_duration = int(route_data.get('duration', 0))
    
    # Extract waypoints along route
    waypoints = extract_waypoints_from_route(route_geometry, interval_miles=50, departure_time=departure_time)
    if not waypoints:
        raise HTTPException(status_code=500, detail="Could not extract waypoints from route")
    
    # Get weather for each waypoint (with concurrent requests)
    waypoints_weather = []
    has_severe = False
    
    async def fetch_waypoint_weather(wp: Waypoint, index: int, total: int, origin_name: str, dest_name: str) -> WaypointWeather:
        nonlocal has_severe
        weather = await get_noaa_weather(wp.lat, wp.lon)
        alerts = await get_noaa_alerts(wp.lat, wp.lon)
        
        # Get location name via reverse geocoding
        location_name = await reverse_geocode(wp.lat, wp.lon)
        
        # Build display name with point number and location
        if index == 0:
            display_name = f"Start - {origin_name}"
        elif index == total - 1:
            display_name = f"End - {dest_name}"
        else:
            point_label = f"Point {index}"
            if location_name:
                display_name = f"{point_label} - {location_name}"
            else:
                display_name = point_label
        
        # Update waypoint with location name
        updated_wp = Waypoint(
            lat=wp.lat,
            lon=wp.lon,
            name=display_name,
            distance_from_start=wp.distance_from_start,
            eta_minutes=wp.eta_minutes,
            arrival_time=wp.arrival_time
        )
        
        # Check for severe weather
        severe_severities = ['Extreme', 'Severe']
        if any(a.severity in severe_severities for a in alerts):
            has_severe = True
        
        return WaypointWeather(
            waypoint=updated_wp,
            weather=weather,
            alerts=alerts
        )
    
    # Fetch weather concurrently
    total_waypoints = len(waypoints)
    tasks = [fetch_waypoint_weather(wp, i, total_waypoints, request.origin, request.destination) for i, wp in enumerate(waypoints)]
    waypoints_weather = await asyncio.gather(*tasks)
    
    # Generate packing suggestions
    packing_suggestions = generate_packing_suggestions(list(waypoints_weather))
    
    # Build weather timeline
    weather_timeline = build_weather_timeline(list(waypoints_weather))
    
    # Generate AI summary
    ai_summary = await generate_ai_summary(list(waypoints_weather), request.origin, request.destination, packing_suggestions)
    
    response = RouteWeatherResponse(
        origin=request.origin,
        destination=request.destination,
        stops=request.stops or [],
        departure_time=departure_time.isoformat(),
        total_duration_minutes=total_duration,
        route_geometry=route_geometry,
        waypoints=list(waypoints_weather),
        ai_summary=ai_summary,
        has_severe_weather=has_severe,
        packing_suggestions=packing_suggestions,
        weather_timeline=weather_timeline
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
            stops=r.get('stops', []),
            is_favorite=r.get('is_favorite', False),
            created_at=r.get('created_at', datetime.utcnow())
        ) for r in routes]
    except Exception as e:
        logger.error(f"Error fetching route history: {e}")
        return []

@api_router.get("/routes/favorites", response_model=List[SavedRoute])
async def get_favorite_routes():
    """Get favorite routes."""
    try:
        routes = await db.favorites.find().sort("created_at", -1).limit(20).to_list(20)
        return [SavedRoute(
            id=r.get('id', str(r.get('_id'))),
            origin=r['origin'],
            destination=r['destination'],
            stops=r.get('stops', []),
            is_favorite=True,
            created_at=r.get('created_at', datetime.utcnow())
        ) for r in routes]
    except Exception as e:
        logger.error(f"Error fetching favorites: {e}")
        return []

@api_router.post("/routes/favorites")
async def add_favorite_route(request: FavoriteRouteRequest):
    """Add a route to favorites."""
    try:
        favorite = {
            "id": str(uuid.uuid4()),
            "origin": request.origin,
            "destination": request.destination,
            "stops": [s.model_dump() for s in (request.stops or [])],
            "name": request.name or f"{request.origin} to {request.destination}",
            "is_favorite": True,
            "created_at": datetime.utcnow()
        }
        await db.favorites.insert_one(favorite)
        return {"success": True, "id": favorite["id"]}
    except Exception as e:
        logger.error(f"Error saving favorite: {e}")
        raise HTTPException(status_code=500, detail="Could not save favorite")

@api_router.delete("/routes/favorites/{route_id}")
async def remove_favorite_route(route_id: str):
    """Remove a route from favorites."""
    try:
        from bson import ObjectId
        # Try custom id field first
        result = await db.favorites.delete_one({"id": route_id})
        if result.deleted_count == 0:
            # Try with MongoDB ObjectId
            try:
                result = await db.favorites.delete_one({"_id": ObjectId(route_id)})
            except:
                pass
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Favorite not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing favorite: {e}")
        raise HTTPException(status_code=500, detail="Could not remove favorite")

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

@api_router.get("/geocode/autocomplete")
async def autocomplete_location(query: str, limit: int = 5):
    """Get autocomplete suggestions for a location query using Mapbox."""
    if not query or len(query) < 2:
        return []
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"
            params = {
                'access_token': MAPBOX_ACCESS_TOKEN,
                'autocomplete': 'true',
                'types': 'place,locality,address,poi',
                'country': 'US',
                'limit': limit
            }
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            suggestions = []
            for feature in data.get('features', []):
                place_name = feature.get('place_name', '')
                text = feature.get('text', '')
                
                # Extract components
                context = feature.get('context', [])
                region = ''
                for ctx in context:
                    if ctx.get('id', '').startswith('region'):
                        region = ctx.get('short_code', '').replace('US-', '')
                        break
                
                suggestions.append({
                    'place_name': place_name,
                    'short_name': f"{text}, {region}" if region else text,
                    'coordinates': feature.get('center', []),
                })
            
            return suggestions
    except Exception as e:
        logger.error(f"Autocomplete error for '{query}': {e}")
        return []

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
