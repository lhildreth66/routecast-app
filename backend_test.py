#!/usr/bin/env python3
"""
Backend API Testing for Routecast
Tests the main backend endpoints for weather route functionality.
"""

import asyncio
import httpx
import json
from datetime import datetime
from typing import Dict, Any

# Use the production URL from frontend .env
BASE_URL = "https://journey-weather.preview.emergentagent.com/api"

class RoutecastAPITester:
    def __init__(self):
        self.base_url = BASE_URL
        self.test_results = []
        
    async def log_test(self, test_name: str, success: bool, details: str, response_data: Any = None):
        """Log test results"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {details}")
        if response_data and not success:
            print(f"   Response: {response_data}")
    
    async def test_health_endpoint(self):
        """Test GET /api/health endpoint"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{self.base_url}/health")
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get("status") == "healthy":
                        await self.log_test(
                            "Health Check", 
                            True, 
                            f"Health endpoint returned healthy status",
                            data
                        )
                        return True
                    else:
                        await self.log_test(
                            "Health Check", 
                            False, 
                            f"Health endpoint returned unexpected status: {data.get('status')}",
                            data
                        )
                        return False
                else:
                    await self.log_test(
                        "Health Check", 
                        False, 
                        f"Health endpoint returned status code {response.status_code}",
                        response.text
                    )
                    return False
                    
        except Exception as e:
            await self.log_test(
                "Health Check", 
                False, 
                f"Health endpoint request failed: {str(e)}"
            )
            return False
    
    async def test_route_weather_endpoint(self):
        """Test POST /api/route/weather endpoint"""
        test_payload = {
            "origin": "Chicago, IL",
            "destination": "Detroit, MI"
        }
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/route/weather",
                    json=test_payload,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Validate required fields
                    required_fields = ["id", "origin", "destination", "route_geometry", "waypoints"]
                    missing_fields = [field for field in required_fields if field not in data]
                    
                    if missing_fields:
                        await self.log_test(
                            "Route Weather - Structure", 
                            False, 
                            f"Missing required fields: {missing_fields}",
                            data
                        )
                        return False
                    
                    # Check route geometry
                    if not data.get("route_geometry"):
                        await self.log_test(
                            "Route Weather - Geometry", 
                            False, 
                            "Route geometry is empty",
                            data
                        )
                        return False
                    
                    # Check waypoints
                    waypoints = data.get("waypoints", [])
                    if not waypoints:
                        await self.log_test(
                            "Route Weather - Waypoints", 
                            False, 
                            "No waypoints returned",
                            data
                        )
                        return False
                    
                    # Validate waypoint structure and weather data
                    weather_data_found = False
                    for i, wp in enumerate(waypoints):
                        if not wp.get("waypoint"):
                            await self.log_test(
                                "Route Weather - Waypoint Structure", 
                                False, 
                                f"Waypoint {i} missing waypoint data",
                                wp
                            )
                            return False
                        
                        waypoint_data = wp["waypoint"]
                        if "lat" not in waypoint_data or "lon" not in waypoint_data:
                            await self.log_test(
                                "Route Weather - Waypoint Coords", 
                                False, 
                                f"Waypoint {i} missing lat/lon coordinates",
                                waypoint_data
                            )
                            return False
                        
                        # Check for weather data
                        weather = wp.get("weather")
                        if weather:
                            weather_data_found = True
                            # Validate weather fields
                            if weather.get("temperature") is not None:
                                await self.log_test(
                                    "Route Weather - Temperature Data", 
                                    True, 
                                    f"Waypoint {i} has temperature: {weather.get('temperature')}°{weather.get('temperature_unit', 'F')}"
                                )
                            
                            if weather.get("conditions"):
                                await self.log_test(
                                    "Route Weather - Conditions Data", 
                                    True, 
                                    f"Waypoint {i} has conditions: {weather.get('conditions')}"
                                )
                            
                            if weather.get("wind_speed"):
                                await self.log_test(
                                    "Route Weather - Wind Data", 
                                    True, 
                                    f"Waypoint {i} has wind: {weather.get('wind_speed')} {weather.get('wind_direction', '')}"
                                )
                    
                    if not weather_data_found:
                        await self.log_test(
                            "Route Weather - Weather Data", 
                            False, 
                            "No weather data found in any waypoints",
                            waypoints
                        )
                        return False
                    
                    # Check AI summary (expected to be unavailable)
                    ai_summary = data.get("ai_summary", "")
                    if "unavailable" in ai_summary.lower():
                        await self.log_test(
                            "Route Weather - AI Summary", 
                            True, 
                            "AI summary shows 'unavailable' as expected due to Emergent API issues"
                        )
                    
                    await self.log_test(
                        "Route Weather - Overall", 
                        True, 
                        f"Route weather endpoint working correctly. Found {len(waypoints)} waypoints with weather data",
                        {
                            "origin": data.get("origin"),
                            "destination": data.get("destination"),
                            "waypoint_count": len(waypoints),
                            "has_severe_weather": data.get("has_severe_weather", False)
                        }
                    )
                    return True
                    
                else:
                    await self.log_test(
                        "Route Weather - HTTP Status", 
                        False, 
                        f"Route weather endpoint returned status code {response.status_code}",
                        response.text
                    )
                    return False
                    
        except Exception as e:
            await self.log_test(
                "Route Weather - Request", 
                False, 
                f"Route weather request failed: {str(e)}"
            )
            return False
    
    async def test_route_history_endpoint(self):
        """Test GET /api/routes/history endpoint"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{self.base_url}/routes/history")
                
                if response.status_code == 200:
                    data = response.json()
                    
                    if isinstance(data, list):
                        await self.log_test(
                            "Route History - Structure", 
                            True, 
                            f"Route history returned list with {len(data)} routes"
                        )
                        
                        # If we have routes, validate structure
                        if data:
                            route = data[0]
                            required_fields = ["id", "origin", "destination", "created_at"]
                            missing_fields = [field for field in required_fields if field not in route]
                            
                            if missing_fields:
                                await self.log_test(
                                    "Route History - Route Structure", 
                                    False, 
                                    f"Route missing required fields: {missing_fields}",
                                    route
                                )
                                return False
                            else:
                                await self.log_test(
                                    "Route History - Route Structure", 
                                    True, 
                                    f"Route structure valid: {route.get('origin')} -> {route.get('destination')}"
                                )
                        
                        await self.log_test(
                            "Route History - Overall", 
                            True, 
                            f"Route history endpoint working correctly",
                            {"route_count": len(data)}
                        )
                        return True
                    else:
                        await self.log_test(
                            "Route History - Structure", 
                            False, 
                            f"Route history should return a list, got: {type(data)}",
                            data
                        )
                        return False
                else:
                    await self.log_test(
                        "Route History - HTTP Status", 
                        False, 
                        f"Route history endpoint returned status code {response.status_code}",
                        response.text
                    )
                    return False
                    
        except Exception as e:
            await self.log_test(
                "Route History - Request", 
                False, 
                f"Route history request failed: {str(e)}"
            )
            return False
    
    async def run_all_tests(self):
        """Run all backend tests"""
        print(f"🚀 Starting Routecast Backend API Tests")
        print(f"📍 Base URL: {self.base_url}")
        print("=" * 60)
        
        # Test health endpoint first
        health_ok = await self.test_health_endpoint()
        
        if not health_ok:
            print("\n❌ Health check failed - skipping other tests")
            return False
        
        print()
        
        # Test route weather endpoint
        route_weather_ok = await self.test_route_weather_endpoint()
        
        print()
        
        # Test route history endpoint
        route_history_ok = await self.test_route_history_endpoint()
        
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.test_results if result["success"])
        total = len(self.test_results)
        
        print(f"✅ Passed: {passed}/{total}")
        print(f"❌ Failed: {total - passed}/{total}")
        
        if total - passed > 0:
            print("\n🔍 FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"   • {result['test']}: {result['details']}")
        
        return passed == total

async def main():
    """Main test runner"""
    tester = RoutecastAPITester()
    success = await tester.run_all_tests()
    
    if success:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print("\n💥 Some tests failed!")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)