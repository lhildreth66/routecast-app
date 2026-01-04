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


class WaypointWeather(BaseModel):
    waypoint: Waypoint
    weather: Optional[WeatherData] = None
    alerts: List[WeatherAlert] = Field(default_factory=list)
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
                    "content": "You are a helpful travel weather assistant providing concise, driver-friendly weather summaries."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=300,
            temperature=0.7,
            timeout=8,
        )

        if response.choices:
            return response.choices[0].message.content or "Route forecast generated successfully."

        return "Route forecast generated successfully."

    except Exception:
        return "Route forecast generated successfully."



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
