from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timedelta
import httpx
import polyline
from openai import AsyncOpenAI
import asyncio
import math

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# API Keys
MAPBOX_ACCESS_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN", "")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# Configure OpenAI client with Emergent LLM key
openai_client = AsyncOpenAI(
    api_key=EMERGENT_LLM_KEY,
    base_url="https://api.emergentagi.com/v1",
)

# NOAA API Headers
NOAA_HEADERS = {
    "User-Agent": "HawkeyeDevWeather/1.0 (lisaannehildreth@gmail.com)",
    "Accept": "application/geo+json",
}

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ==================== Models ====================

class StopPoint(BaseModel):
    location: str
    type: str = "stop"  # stop, gas, food, rest


class RouteRequest(BaseModel):
    origin: str
    destination: str
    departure_time: Optional[str] = None  # ISO format datetime
    stops: List[StopPoint] = Field(default_factory=list)
    check_bridges: bool = False
    vehicle_height: Optional[float] = None  # in feet or meters
    vehicle_height_unit: str = "feet"  # "feet" or "meters"


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
    hourly_forecast: List[HourlyForecast] = Field(default_factory=list)


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


class BridgeClearance(BaseModel):
    name: Optional[str] = None
    clearance_feet: float
    clearance_meters: float
    lat: float
    lon: float
    distance_from_start: Optional[float] = None
    road_name: Optional[str] = None
    warning_level: str = "caution"  # caution, warning, critical


class DelayRiskScore(BaseModel):
    overall_risk_percent: int  # 0-100
    risk_level: str  # low, medium, high, critical
    estimated_delay_minutes: int  # Estimated delay in minutes
    risk_factors: List[str] = Field(default_factory=list)
    confidence: str = "medium"  # low, medium, high


class DriveWindowAdvice(BaseModel):
    recommendation: str  # "depart_now", "depart_earlier", "depart_later", "postpone"
    optimal_departure_time: Optional[str] = None  # ISO format
    reason: str
    time_shift_minutes: int = 0  # Positive = later, Negative = earlier
    alternate_route_available: bool = False


class WaypointWeather(BaseModel):
    waypoint: Waypoint
    weather: Optional[WeatherData] = None
    alerts: List[WeatherAlert] = Field(default_factory=list)
    bridge_warnings: List[BridgeClearance] = Field(default_factory=list)
    error: Optional[str] = None


class RouteWeatherResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    origin: str
    destination: str
    stops: List[StopPoint] = Field(default_factory=list)
    departure_time: Optional[str] = None
    total_duration_minutes: Optional[int] = None
    route_geometry: str  # Encoded polyline
    waypoints: List[WaypointWeather] = Field(default_factory=list)
    ai_summary: Optional[str] = None
    has_severe_weather: bool = False
    has_bridge_warnings: bool = False
    bridge_clearances: List[BridgeClearance] = Field(default_factory=list)
    delay_risk_score: Optional[DelayRiskScore] = None
    drive_window_advice: Optional[DriveWindowAdvice] = None
    packing_suggestions: List[PackingSuggestion] = Field(default_factory=list)
    weather_timeline: List[HourlyForecast] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_favorite: bool = False


class SavedRoute(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    origin: str
    destination: str
    stops: List[StopPoint] = Field(default_factory=list)
    is_favorite: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FavoriteRouteRequest(BaseModel):
    origin: str
    destination: str
    stops: List[StopPoint] = Field(default_factory=list)
    name: Optional[str] = None


# ==================== Helper Functions ====================

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3959  # miles
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def calculate_eta(distance_miles: float, avg_speed_mph: float = 55) -> int:
    return int((distance_miles / avg_speed_mph) * 60)


def extract_waypoints_from_route(
    encoded_polyline: str,
    interval_miles: float = 50,
    departure_time: Optional[datetime] = None,
) -> List[Waypoint]:
    try:
        coords = polyline.decode(encoded_polyline)
        if not coords:
            return []

        waypoints: List[Waypoint] = []
        total_distance = 0.0
        last_waypoint_distance = 0.0

        dep_time = departure_time or datetime.now()

        waypoints.append(
            Waypoint(
                lat=coords[0][0],
                lon=coords[0][1],
                name="Start",
                distance_from_start=0,
                eta_minutes=0,
                arrival_time=dep_time.isoformat(),
            )
        )

        for i in range(1, len(coords)):
            lat1, lon1 = coords[i - 1]
            lat2, lon2 = coords[i]
            segment_distance = haversine_distance(lat1, lon1, lat2, lon2)
            total_distance += segment_distance

            if total_distance - last_waypoint_distance >= interval_miles:
                eta_mins = calculate_eta(total_distance)
                arrival = dep_time + timedelta(minutes=eta_mins)
                waypoints.append(
                    Waypoint(
                        lat=lat2,
                        lon=lon2,
                        name=f"Mile {int(total_distance)}",
                        distance_from_start=round(total_distance, 1),
                        eta_minutes=eta_mins,
                        arrival_time=arrival.isoformat(),
                    )
                )
                last_waypoint_distance = total_distance

        end_lat, end_lon = coords[-1]
        if len(waypoints) == 1 or haversine_distance(
            waypoints[-1].lat, waypoints[-1].lon, end_lat, end_lon
        ) > 10:
            eta_mins = calculate_eta(total_distance)
            arrival = dep_time + timedelta(minutes=eta_mins)
            waypoints.append(
                Waypoint(
                    lat=end_lat,
                    lon=end_lon,
                    name="Destination",
                    distance_from_start=round(total_distance, 1),
                    eta_minutes=eta_mins,
                    arrival_time=arrival.isoformat(),
                )
            )

        return waypoints
    except Exception as e:
        logger.error(f"Error extracting waypoints: {e}")
        return []


async def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client_http:
            url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{lon},{lat}.json"
            params = {
                "access_token": MAPBOX_ACCESS_TOKEN,
                "types": "place,locality",
                "limit": 1,
            }
            response = await client_http.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            if data.get("features"):
                feature = data["features"][0]
                place_name = feature.get("text", "")

                context = feature.get("context", [])
                state = ""
                for ctx in context:
                    if ctx.get("id", "").startswith("region"):
                        state = ctx.get("short_code", "").replace("US-", "")
                        break

                if place_name and state:
                    return f"{place_name}, {state}"
                return place_name or None
    except Exception as e:
        logger.error(f"Reverse geocoding error for {lat},{lon}: {e}")
    return None


async def geocode_location(location: str) -> Optional[Dict[str, float]]:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client_http:
            url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{location}.json"
            params = {"access_token": MAPBOX_ACCESS_TOKEN, "limit": 1, "country": "US"}
            response = await client_http.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            if data.get("features"):
                coords = data["features"][0]["center"]
                return {"lon": float(coords[0]), "lat": float(coords[1])}
    except Exception as e:
        logger.error(f"Geocoding error for {location}: {e}")
    return None


async def get_mapbox_route(
    origin_coords: Dict[str, float],
    dest_coords: Dict[str, float],
    waypoints: Optional[List[Dict[str, float]]] = None,
) -> Optional[Dict]:
    try:
        coords_list = [f"{origin_coords['lon']},{origin_coords['lat']}"]
        if waypoints:
            for wp in waypoints:
                coords_list.append(f"{wp['lon']},{wp['lat']}")
        coords_list.append(f"{dest_coords['lon']},{dest_coords['lat']}")
        coords_str = ";".join(coords_list)

        async with httpx.AsyncClient(timeout=30.0) as client_http:
            url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coords_str}"
            params = {
                "access_token": MAPBOX_ACCESS_TOKEN,
                "geometries": "polyline",
                "overview": "full",
            }
            response = await client_http.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            if data.get("routes"):
                route = data["routes"][0]
                return {
                    "geometry": route["geometry"],
                    "duration": (route.get("duration", 0) / 60),  # minutes
                    "distance": (route.get("distance", 0) / 1609.34),  # miles
                }
    except Exception as e:
        logger.error(f"Mapbox route error: {e}")
    return None


async def get_noaa_weather(lat: float, lon: float) -> Optional[WeatherData]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client_http:
            point_url = f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}"
            point_response = await client_http.get(point_url, headers=NOAA_HEADERS)

            if point_response.status_code != 200:
                logger.warning(
                    f"NOAA points API error for {lat},{lon}: {point_response.status_code}"
                )
                return None

            point_data = point_response.json()
            props = point_data.get("properties", {})
            forecast_url = props.get("forecastHourly")
            if not forecast_url:
                return None

            forecast_response = await client_http.get(forecast_url, headers=NOAA_HEADERS)
            if forecast_response.status_code != 200:
                logger.warning(f"NOAA forecast API error: {forecast_response.status_code}")
                return None

            forecast_data = forecast_response.json()
            periods = forecast_data.get("properties", {}).get("periods", [])

            hourly_forecast: List[HourlyForecast] = []
            for period in periods[:12]:
                hourly_forecast.append(
                    HourlyForecast(
                        time=period.get("startTime", ""),
                        temperature=period.get("temperature", 0),
                        conditions=period.get("shortForecast", ""),
                        wind_speed=period.get("windSpeed", ""),
                        precipitation_chance=(
                            period.get("probabilityOfPrecipitation", {}) or {}
                        ).get("value"),
                    )
                )

            if periods:
                current = periods[0]
                is_daytime = current.get("isDaytime", True)
                now = datetime.now()
                sunrise = now.replace(hour=6, minute=30).strftime("%I:%M %p")
                sunset = now.replace(hour=18, minute=30).strftime("%I:%M %p")

                return WeatherData(
                    temperature=current.get("temperature"),
                    temperature_unit=current.get("temperatureUnit", "F"),
                    wind_speed=current.get("windSpeed"),
                    wind_direction=current.get("windDirection"),
                    conditions=current.get("shortForecast"),
                    icon=current.get("icon"),
                    humidity=(current.get("relativeHumidity", {}) or {}).get("value"),
                    is_daytime=is_daytime,
                    sunrise=sunrise,
                    sunset=sunset,
                    hourly_forecast=hourly_forecast,
                )
    except Exception as e:
        logger.error(f"NOAA weather error for {lat},{lon}: {e}")
    return None


async def get_noaa_alerts(lat: float, lon: float) -> List[WeatherAlert]:
    alerts: List[WeatherAlert] = []
    try:
        async with httpx.AsyncClient(timeout=30.0) as client_http:
            url = f"https://api.weather.gov/alerts?point={lat:.4f},{lon:.4f}"
            response = await client_http.get(url, headers=NOAA_HEADERS)

            if response.status_code == 200:
                data = response.json()
                features = data.get("features", [])
                for feature in features[:5]:
                    props = feature.get("properties", {}) or {}
                    alerts.append(
                        WeatherAlert(
                            id=props.get("id", str(uuid.uuid4())),
                            headline=props.get("headline", "Weather Alert"),
                            severity=props.get("severity", "Unknown"),
                            event=props.get("event", "Weather Event"),
                            description=(props.get("description", "") or "")[:500],
                            areas=props.get("areaDesc"),
                        )
                    )
    except Exception as e:
        logger.error(f"NOAA alerts error for {lat},{lon}: {e}")
    return alerts


def generate_packing_suggestions(
    waypoints_weather: List[WaypointWeather],
) -> List[PackingSuggestion]:
    suggestions: List[PackingSuggestion] = []
    temps: List[int] = []
    has_rain = has_snow = has_wind = has_sun = False

    for wp in waypoints_weather:
        if wp.weather:
            if wp.weather.temperature is not None:
                temps.append(wp.weather.temperature)

            conditions = (wp.weather.conditions or "").lower()
            if "rain" in conditions or "shower" in conditions:
                has_rain = True
            if "snow" in conditions or "flurr" in conditions:
                has_snow = True
            if "wind" in conditions:
                has_wind = True
            if "sun" in conditions or "clear" in conditions:
                has_sun = True

            wind = wp.weather.wind_speed or ""
            if any(f"{x}" in wind for x in range(15, 50)):
                has_wind = True

    if temps:
        min_temp = min(temps)
        max_temp = max(temps)

        if min_temp < 40:
            suggestions.append(
                PackingSuggestion(
                    item="Warm jacket",
                    reason=f"Temperatures as low as {min_temp}°F expected",
                    priority="essential",
                )
            )
        if min_temp < 32:
            suggestions.append(
                PackingSuggestion(
                    item="Gloves & hat",
                    reason="Freezing temperatures along route",
                    priority="essential",
                )
            )
        if max_temp > 85:
            suggestions.append(
                PackingSuggestion(
                    item="Extra water",
                    reason=f"High temperatures up to {max_temp}°F",
                    priority="essential",
                )
            )
        if max_temp - min_temp > 20:
            suggestions.append(
                PackingSuggestion(
                    item="Layers",
                    reason=f"Temperature range of {max_temp - min_temp}°F",
                    priority="recommended",
                )
            )

    if has_rain:
        suggestions.append(
            PackingSuggestion(
                item="Umbrella/rain jacket",
                reason="Rain expected along route",
                priority="essential",
            )
        )
    if has_snow:
        suggestions.append(
            PackingSuggestion(
                item="Snow gear & emergency kit",
                reason="Snow conditions expected",
                priority="essential",
            )
        )
    if has_wind:
        suggestions.append(
            PackingSuggestion(
                item="Windbreaker",
                reason="Windy conditions expected",
                priority="recommended",
            )
        )
    if has_sun:
        suggestions.append(
            PackingSuggestion(
                item="Sunglasses",
                reason="Sunny conditions expected",
                priority="recommended",
            )
        )
        suggestions.append(
            PackingSuggestion(
                item="Sunscreen",
                reason="Sun exposure during drive",
                priority="optional",
            )
        )

    suggestions.append(
        PackingSuggestion(
            item="Phone charger",
            reason="Keep devices charged for navigation",
            priority="essential",
        )
    )
    suggestions.append(
        PackingSuggestion(
            item="Snacks & water",
            reason="Stay hydrated and energized",
            priority="recommended",
        )
    )

    return suggestions[:8]


def build_weather_timeline(waypoints_weather: List[WaypointWeather]) -> List[HourlyForecast]:
    timeline: List[HourlyForecast] = []
    seen_times = set()

    for wp in waypoints_weather:
        if wp.weather and wp.weather.hourly_forecast:
            for forecast in wp.weather.hourly_forecast[:4]:
                if forecast.time and forecast.time not in seen_times:
                    timeline.append(forecast)
                    seen_times.add(forecast.time)

    timeline.sort(key=lambda x: x.time)
    return timeline[:12]

async def generate_ai_summary(prompt: str) -> str:
    try:
        response = await openai_client.chat.completions.create(
            model="gemini-2.0-flash",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a travel weather assistant. "
                        "Write a concise, driver-friendly weather summary for a road trip. "
                        "Rules: 2-4 short sentences max. "
                        "If there are alerts, mention them first. "
                        "Include 1-3 quick action tips (like slow down, allow extra time, pack gloves, watch for ice). "
                        "No markdown, no bullets, plain text only."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=220,
            temperature=0.4,
            timeout=8,
        )

        if response.choices and response.choices[0].message and response.choices[0].message.content:
            return response.choices[0].message.content.strip()

        return ""

    except Exception:
        return ""



def build_ai_prompt(
    waypoints_weather: List[WaypointWeather],
    origin: str,
    destination: str,
    packing: List[PackingSuggestion],
) -> str:
    lines: List[str] = []
    alerts_lines: List[str] = []

    for wp in waypoints_weather:
        if wp.weather:
            name = wp.waypoint.name or "Point"
            miles = wp.waypoint.distance_from_start
            miles_txt = f"{miles} mi" if miles is not None else ""
            temp = wp.weather.temperature
            unit = wp.weather.temperature_unit or "F"
            cond = wp.weather.conditions or ""
            wind = (wp.weather.wind_speed or "").strip()
            wdir = (wp.weather.wind_direction or "").strip()
            eta = wp.waypoint.arrival_time
            eta_txt = f" ETA {eta[:16]}" if eta else ""

            lines.append(
                f"- {name} ({miles_txt}): {temp}°{unit}, {cond}, Wind: {wind} {wdir}{eta_txt}".strip()
            )

        for alert in (wp.alerts or []):
            alerts_lines.append(f"- {alert.event}: {alert.headline}")

    weather_text = "\n".join(lines) if lines else "No weather data available"
    alerts_text = "\n".join(sorted(set(alerts_lines))) if alerts_lines else "No active alerts"
    packing_text = ", ".join([p.item for p in packing[:5]]) if packing else "Standard travel items"

    return f"""Route: {origin} to {destination}

Weather along route:
{weather_text}

Active Alerts:
{alerts_text}

Suggested packing: {packing_text}

Provide a 2-3 sentence summary focusing on:
1. Overall driving conditions
2. Any weather concerns or hazards
3. Key recommendations for the driver

Be concise and practical.
"""


def calculate_delay_risk_score(waypoints_weather: List[WaypointWeather]) -> DelayRiskScore:
    """
    Calculate delay risk score based on weather conditions along the route.
    """
    risk_factors = []
    total_risk_points = 0
    max_risk_points = 0
    
    # Weight factors for different conditions
    SEVERITY_WEIGHTS = {
        "Extreme": 40,
        "Severe": 30,
        "Moderate": 15,
        "Minor": 5
    }
    
    for wp in waypoints_weather:
        # Check for severe weather alerts
        if wp.alerts:
            for alert in wp.alerts:
                severity = alert.severity
                if severity in SEVERITY_WEIGHTS:
                    points = SEVERITY_WEIGHTS[severity]
                    total_risk_points += points
                    max_risk_points += 40  # Max possible per waypoint
                    
                    if severity in ["Extreme", "Severe"]:
                        risk_factors.append(f"{alert.event} - {severity}")
        else:
            max_risk_points += 40
        
        # Check weather conditions
        if wp.weather:
            weather = wp.weather
            
            # Heavy precipitation
            if weather.conditions:
                conditions_lower = weather.conditions.lower()
                if any(term in conditions_lower for term in ["heavy rain", "heavy snow", "blizzard", "thunderstorm"]):
                    total_risk_points += 20
                    risk_factors.append(f"Heavy precipitation: {weather.conditions}")
                elif any(term in conditions_lower for term in ["rain", "snow", "sleet", "ice"]):
                    total_risk_points += 10
                    risk_factors.append(f"Precipitation: {weather.conditions}")
            
            # High winds
            if weather.wind_speed:
                try:
                    wind_str = str(weather.wind_speed).lower().replace("mph", "").replace("km/h", "").strip()
                    wind_speed = float(wind_str.split()[0])
                    if wind_speed > 40:
                        total_risk_points += 15
                        risk_factors.append(f"High winds: {weather.wind_speed}")
                    elif wind_speed > 25:
                        total_risk_points += 8
                except (ValueError, IndexError):
                    pass
            
            # Extreme temperatures
            if weather.temperature is not None:
                if weather.temperature <= 32:
                    total_risk_points += 10
                    risk_factors.append(f"Freezing conditions: {weather.temperature}°F")
                elif weather.temperature >= 100:
                    total_risk_points += 5
                    risk_factors.append(f"Extreme heat: {weather.temperature}°F")
            
            max_risk_points += 50  # Max weather points per waypoint
    
    # Calculate percentage
    if max_risk_points > 0:
        risk_percent = min(100, int((total_risk_points / max_risk_points) * 100))
    else:
        risk_percent = 0
    
    # Determine risk level
    if risk_percent < 20:
        risk_level = "low"
        estimated_delay = 0
    elif risk_percent < 50:
        risk_level = "medium"
        estimated_delay = 15
    elif risk_percent < 80:
        risk_level = "high"
        estimated_delay = 45
    else:
        risk_level = "critical"
        estimated_delay = 120
    
    # Adjust estimated delay based on number of problem areas
    num_risk_areas = len(risk_factors)
    if num_risk_areas > 3:
        estimated_delay = int(estimated_delay * 1.5)
    
    # Remove duplicate risk factors
    risk_factors = list(dict.fromkeys(risk_factors))[:5]  # Limit to top 5
    
    confidence = "high" if len(waypoints_weather) >= 3 else "medium"
    
    return DelayRiskScore(
        overall_risk_percent=risk_percent,
        risk_level=risk_level,
        estimated_delay_minutes=estimated_delay,
        risk_factors=risk_factors,
        confidence=confidence
    )


def calculate_drive_window_advice(
    waypoints_weather: List[WaypointWeather],
    delay_risk: DelayRiskScore,
    departure_time: datetime
) -> DriveWindowAdvice:
    """
    Provide advice on when to depart based on weather forecast.
    """
    # Analyze weather timeline to find optimal departure window
    worst_weather_time = None
    worst_risk_score = 0
    
    # Find peak bad weather
    for wp in waypoints_weather:
        if wp.alerts:
            for alert in wp.alerts:
                if alert.severity in ["Extreme", "Severe"]:
                    # Weather is severe along route
                    worst_weather_time = departure_time
                    worst_risk_score = max(worst_risk_score, 80)
    
    # Decision logic
    if delay_risk.risk_level == "critical":
        # Suggest postponing
        return DriveWindowAdvice(
            recommendation="postpone",
            optimal_departure_time=None,
            reason="Critical weather conditions detected along your route. Consider postponing your trip or taking an alternate route.",
            time_shift_minutes=0,
            alternate_route_available=True
        )
    
    elif delay_risk.risk_level == "high":
        # Suggest leaving later to avoid peak conditions
        optimal_time = departure_time + timedelta(hours=2)
        return DriveWindowAdvice(
            recommendation="depart_later",
            optimal_departure_time=optimal_time.isoformat(),
            reason=f"Severe weather expected along route. Consider departing 2 hours later to avoid peak conditions.",
            time_shift_minutes=120,
            alternate_route_available=True
        )
    
    elif delay_risk.risk_level == "medium":
        # Suggest leaving earlier if possible
        if departure_time.hour > 6:  # Only suggest earlier if it's not too early
            optimal_time = departure_time - timedelta(minutes=30)
            return DriveWindowAdvice(
                recommendation="depart_earlier",
                optimal_departure_time=optimal_time.isoformat(),
                reason="Moderate weather developing. Consider leaving 30 minutes earlier to stay ahead of conditions.",
                time_shift_minutes=-30,
                alternate_route_available=False
            )
        else:
            return DriveWindowAdvice(
                recommendation="depart_now",
                optimal_departure_time=departure_time.isoformat(),
                reason="Current departure time is optimal. Minor weather possible but manageable.",
                time_shift_minutes=0,
                alternate_route_available=False
            )
    
    else:  # low risk
        return DriveWindowAdvice(
            recommendation="depart_now",
            optimal_departure_time=departure_time.isoformat(),
            reason="Weather conditions are favorable for your trip. Safe travels!",
            time_shift_minutes=0,
            alternate_route_available=False
        )


async def check_bridge_clearances(
    route_coords: List[tuple],
    vehicle_height_feet: float,
    total_distance_miles: float
) -> List[BridgeClearance]:
    """
    Check for low bridge clearances along the route using OpenStreetMap Overpass API.
    """
    try:
        # Create a bounding box from route coordinates
        lats = [coord[0] for coord in route_coords]
        lons = [coord[1] for coord in route_coords]
        
        min_lat, max_lat = min(lats), max(lats)
        min_lon, max_lon = min(lons), max(lons)
        
        # Add buffer (approximately 0.5 miles in degrees)
        buffer = 0.01
        bbox = f"{min_lat - buffer},{min_lon - buffer},{max_lat + buffer},{max_lon + buffer}"
        
        # Query Overpass API for bridges with maxheight tags
        overpass_url = "https://overpass-api.de/api/interpreter"
        query = f"""
        [out:json][timeout:25];
        (
          way["bridge"]["maxheight"]({bbox});
          way["highway"]["maxheight"]["bridge"]({bbox});
        );
        out body;
        >;
        out skel qt;
        """
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(overpass_url, data={"data": query})
            
            if response.status_code != 200:
                logger.warning(f"Overpass API returned status {response.status_code}")
                return []
            
            data = response.json()
            elements = data.get("elements", [])
            
            bridges = []
            nodes_map = {}
            
            # Build node map
            for elem in elements:
                if elem.get("type") == "node":
                    nodes_map[elem["id"]] = (elem["lat"], elem["lon"])
            
            # Process ways (bridges)
            for elem in elements:
                if elem.get("type") == "way" and "maxheight" in elem.get("tags", {}):
                    maxheight_str = elem["tags"]["maxheight"]
                    
                    # Parse height (could be in feet or meters)
                    try:
                        # Remove units and convert
                        maxheight_str = maxheight_str.replace("'", "").replace('"', "").replace("ft", "").replace("m", "").strip()
                        
                        # Check if it's feet or meters
                        if "'" in elem["tags"]["maxheight"] or "ft" in elem["tags"]["maxheight"].lower():
                            clearance_feet = float(maxheight_str)
                        else:
                            # Assume meters
                            clearance_meters = float(maxheight_str)
                            clearance_feet = clearance_meters * 3.28084
                        
                        clearance_meters = clearance_feet / 3.28084
                        
                        # Only include if it's lower than vehicle height
                        if clearance_feet <= vehicle_height_feet + 1.0:  # 1 foot buffer
                            # Get center point of the bridge
                            node_ids = elem.get("nodes", [])
                            if node_ids:
                                bridge_coords = [nodes_map[nid] for nid in node_ids if nid in nodes_map]
                                if bridge_coords:
                                    center_lat = sum(c[0] for c in bridge_coords) / len(bridge_coords)
                                    center_lon = sum(c[1] for c in bridge_coords) / len(bridge_coords)
                                    
                                    # Calculate distance from start
                                    distance_from_start = 0
                                    for i, (lat, lon) in enumerate(route_coords):
                                        if i > 0:
                                            distance_from_start += haversine_distance(
                                                route_coords[i-1][0], route_coords[i-1][1],
                                                lat, lon
                                            )
                                        
                                        # Check if this bridge is near this route point
                                        dist_to_bridge = haversine_distance(lat, lon, center_lat, center_lon)
                                        if dist_to_bridge < 0.5:  # Within 0.5 miles
                                            warning_level = "caution"
                                            if clearance_feet < vehicle_height_feet:
                                                warning_level = "critical"
                                            elif clearance_feet < vehicle_height_feet + 0.5:
                                                warning_level = "warning"
                                            
                                            bridges.append(BridgeClearance(
                                                name=elem["tags"].get("name", f"Bridge at mile {int(distance_from_start)}"),
                                                clearance_feet=round(clearance_feet, 1),
                                                clearance_meters=round(clearance_meters, 2),
                                                lat=center_lat,
                                                lon=center_lon,
                                                distance_from_start=round(distance_from_start, 1),
                                                road_name=elem["tags"].get("highway", "Unknown"),
                                                warning_level=warning_level
                                            ))
                                            break
                    except (ValueError, KeyError) as e:
                        logger.debug(f"Could not parse bridge height: {maxheight_str}, error: {e}")
                        continue
            
            # Sort by distance from start
            bridges.sort(key=lambda b: b.distance_from_start or 0)
            return bridges
            
    except Exception as e:
        logger.error(f"Error checking bridge clearances: {e}")
        return []


# ==================== API Routes ====================

@api_router.get("/")
async def root():
    return {
        "message": "Routecast API",
        "version": "2.0",
        "features": ["departure_time", "multi_stop", "favorites", "packing_suggestions", "weather_timeline"],
    }


@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@api_router.post("/route/weather", response_model=RouteWeatherResponse)
async def get_route_weather(request: RouteRequest):
    logger.info(f"Route weather request: {request.origin} -> {request.destination}")

    # Parse departure time
    if request.departure_time:
        try:
            departure_time = datetime.fromisoformat(request.departure_time.replace("Z", "+00:00"))
        except Exception:
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
    stop_coords: List[Dict[str, float]] = []
    if request.stops:
        for stop in request.stops:
            coords = await geocode_location(stop.location)
            if coords:
                stop_coords.append(coords)

    # Get route from Mapbox
    route_data = await get_mapbox_route(origin_coords, dest_coords, stop_coords if stop_coords else None)
    if not route_data:
        raise HTTPException(status_code=500, detail="Could not get route from Mapbox")

    route_geometry = route_data["geometry"]
    total_duration = int(route_data.get("duration", 0))

    # Extract waypoints along route
    waypoints = extract_waypoints_from_route(route_geometry, interval_miles=50, departure_time=departure_time)
    if not waypoints:
        raise HTTPException(status_code=500, detail="Could not extract waypoints from route")

    has_severe = False

    async def fetch_waypoint_weather(wp: Waypoint, index: int, total: int) -> WaypointWeather:
        nonlocal has_severe

        weather = await get_noaa_weather(wp.lat, wp.lon)
        alerts = await get_noaa_alerts(wp.lat, wp.lon)
        location_name = await reverse_geocode(wp.lat, wp.lon)

        if index == 0:
            display_name = f"Start - {request.origin}"
        elif index == total - 1:
            display_name = f"End - {request.destination}"
        else:
            display_name = f"Point {index}"
            if location_name:
                display_name = f"{display_name} - {location_name}"

        updated_wp = Waypoint(
            lat=wp.lat,
            lon=wp.lon,
            name=display_name,
            distance_from_start=wp.distance_from_start,
            eta_minutes=wp.eta_minutes,
            arrival_time=wp.arrival_time,
        )

        severe_severities = {"Extreme", "Severe"}
        if any((a.severity in severe_severities) for a in (alerts or [])):
            has_severe = True

        return WaypointWeather(waypoint=updated_wp, weather=weather, alerts=alerts)

    total_waypoints = len(waypoints)
    tasks = [fetch_waypoint_weather(wp, i, total_waypoints) for i, wp in enumerate(waypoints)]
    waypoints_weather = await asyncio.gather(*tasks)

    packing_suggestions = generate_packing_suggestions(list(waypoints_weather))
    weather_timeline = build_weather_timeline(list(waypoints_weather))

    # Check for bridge clearances if requested
    bridge_clearances = []
    has_bridge_warnings = False
    if request.check_bridges and request.vehicle_height:
        vehicle_height_feet = request.vehicle_height
        if request.vehicle_height_unit == "meters":
            vehicle_height_feet = request.vehicle_height * 3.28084
        
        # Decode route geometry to get coordinates
        route_coords = polyline.decode(route_geometry)
        total_distance = sum(
            haversine_distance(route_coords[i][0], route_coords[i][1], 
                             route_coords[i+1][0], route_coords[i+1][1])
            for i in range(len(route_coords) - 1)
        )
        
        bridge_clearances = await check_bridge_clearances(
            route_coords,
            vehicle_height_feet,
            total_distance
        )
        has_bridge_warnings = len(bridge_clearances) > 0

    # Calculate delay risk score (PREMIUM FEATURE)
    delay_risk = calculate_delay_risk_score(list(waypoints_weather))
    
    # Calculate drive window advice (PREMIUM FEATURE)
    drive_window = calculate_drive_window_advice(
        list(waypoints_weather),
        delay_risk,
        departure_time
    )

    prompt = build_ai_prompt(
        waypoints_weather=list(waypoints_weather),
        origin=request.origin,
        destination=request.destination,
        packing=packing_suggestions,
    )
    ai_summary = await generate_ai_summary(prompt)

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
        has_bridge_warnings=has_bridge_warnings,
        bridge_clearances=bridge_clearances,
        delay_risk_score=delay_risk,
        drive_window_advice=drive_window,
        packing_suggestions=packing_suggestions,
        weather_timeline=weather_timeline,
    )

    try:
        await db.routes.insert_one(response.model_dump())
    except Exception as e:
        logger.error(f"Error saving route: {e}")

    return response


@api_router.get("/routes/history", response_model=List[SavedRoute])
async def get_route_history():
    try:
        routes = await db.routes.find().sort("created_at", -1).limit(10).to_list(10)
        results: List[SavedRoute] = []
        for r in routes:
            results.append(
                SavedRoute(
                    id=str(r.get("id", r.get("_id"))),
                    origin=r["origin"],
                    destination=r["destination"],
                    stops=r.get("stops", []),
                    is_favorite=r.get("is_favorite", False),
                    created_at=r.get("created_at", datetime.utcnow()),
                )
            )
        return results
    except Exception as e:
        logger.error(f"Error fetching route history: {e}")
        return []


@api_router.get("/routes/favorites", response_model=List[SavedRoute])
async def get_favorite_routes():
    try:
        routes = await db.favorites.find().sort("created_at", -1).limit(20).to_list(20)
        results: List[SavedRoute] = []
        for r in routes:
            results.append(
                SavedRoute(
                    id=str(r.get("id", r.get("_id"))),
                    origin=r["origin"],
                    destination=r["destination"],
                    stops=r.get("stops", []),
                    is_favorite=True,
                    created_at=r.get("created_at", datetime.utcnow()),
                )
            )
        return results
    except Exception as e:
        logger.error(f"Error fetching favorites: {e}")
        return []


@api_router.post("/routes/favorites")
async def add_favorite_route(request: FavoriteRouteRequest):
    try:
        favorite = {
            "id": str(uuid.uuid4()),
            "origin": request.origin,
            "destination": request.destination,
            "stops": [s.model_dump() for s in (request.stops or [])],
            "name": request.name or f"{request.origin} to {request.destination}",
            "is_favorite": True,
            "created_at": datetime.utcnow(),
        }
        await db.favorites.insert_one(favorite)
        return {"success": True, "id": favorite["id"]}
    except Exception as e:
        logger.error(f"Error saving favorite: {e}")
        raise HTTPException(status_code=500, detail="Could not save favorite")


@api_router.delete("/routes/favorites/{route_id}")
async def remove_favorite_route(route_id: str):
    try:
        from bson import ObjectId

        result = await db.favorites.delete_one({"id": route_id})
        if result.deleted_count == 0:
            try:
                result = await db.favorites.delete_one({"_id": ObjectId(route_id)})
            except Exception:
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
    try:
        route = await db.routes.find_one({"id": route_id})
        if not route:
            raise HTTPException(status_code=404, detail="Route not found")
        route.pop("_id", None)
        return RouteWeatherResponse(**route)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching route {route_id}: {e}")
        raise HTTPException(status_code=500, detail="Error fetching route")


@api_router.post("/geocode")
async def geocode(location: str):
    coords = await geocode_location(location)
    if not coords:
        raise HTTPException(status_code=404, detail="Location not found")
    return coords


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
