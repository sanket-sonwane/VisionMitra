#!/usr/bin/env python3
"""
Eye Guide Navigation System Backend API Tests
Tests all critical backend APIs for the navigation system
"""

import requests
import json
import base64
from io import BytesIO
from PIL import Image
import time
import sys

# Backend URL from frontend .env
BASE_URL = "https://eyeguide-4.preview.emergentagent.com/api"

class EyeGuideAPITester:
    def __init__(self):
        self.base_url = BASE_URL
        self.test_user_id = None
        self.test_session_id = None
        self.test_contact_id = None
        self.results = []
        
    def log_result(self, test_name, success, message, response_data=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        self.results.append({
            "test": test_name,
            "success": success,
            "message": message,
            "response_data": response_data
        })
        
    def create_test_image_base64(self):
        """Create a small test image and convert to base64"""
        try:
            # Create a simple 100x100 red square image
            img = Image.new('RGB', (100, 100), color='red')
            buffer = BytesIO()
            img.save(buffer, format='PNG')
            img_bytes = buffer.getvalue()
            return base64.b64encode(img_bytes).decode('utf-8')
        except Exception as e:
            print(f"Error creating test image: {e}")
            return None
    
    def test_health_check(self):
        """Test health check endpoint"""
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "status" in data and "database" in data and "vision_ai" in data:
                    self.log_result("Health Check", True, f"System healthy - DB: {data['database']}, Vision AI: {data['vision_ai']}", data)
                else:
                    self.log_result("Health Check", False, f"Missing required fields in response: {data}")
            else:
                self.log_result("Health Check", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Health Check", False, f"Request failed: {str(e)}")
    
    def test_create_user(self):
        """Test user creation"""
        try:
            user_data = {
                "name": "Sarah Johnson",
                "phone": "+1-555-0123"
            }
            response = requests.post(f"{self.base_url}/users", json=user_data, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "id" in data and "name" in data and "phone" in data:
                    self.test_user_id = data["id"]
                    self.log_result("Create User", True, f"User created with ID: {self.test_user_id}", data)
                else:
                    self.log_result("Create User", False, f"Missing required fields in response: {data}")
            else:
                self.log_result("Create User", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Create User", False, f"Request failed: {str(e)}")
    
    def test_get_user(self):
        """Test user retrieval"""
        if not self.test_user_id:
            self.log_result("Get User", False, "No test user ID available")
            return
            
        try:
            response = requests.get(f"{self.base_url}/users/{self.test_user_id}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get("id") == self.test_user_id and "name" in data:
                    self.log_result("Get User", True, f"Retrieved user: {data['name']}", data)
                else:
                    self.log_result("Get User", False, f"User data mismatch: {data}")
            else:
                self.log_result("Get User", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Get User", False, f"Request failed: {str(e)}")
    
    def test_create_emergency_contacts(self):
        """Test emergency contact creation"""
        if not self.test_user_id:
            self.log_result("Create Emergency Contacts", False, "No test user ID available")
            return
            
        contacts = [
            {
                "user_id": self.test_user_id,
                "name": "Michael Johnson",
                "phone": "+1-555-0124",
                "relationship": "spouse",
                "priority": 1
            },
            {
                "user_id": self.test_user_id,
                "name": "Dr. Emily Chen",
                "phone": "+1-555-0125",
                "relationship": "doctor",
                "priority": 2
            }
        ]
        
        created_contacts = 0
        for contact in contacts:
            try:
                response = requests.post(f"{self.base_url}/emergency-contacts", json=contact, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if "id" in data and data.get("user_id") == self.test_user_id:
                        created_contacts += 1
                        if not self.test_contact_id:  # Store first contact ID for deletion test
                            self.test_contact_id = data["id"]
                    else:
                        self.log_result("Create Emergency Contacts", False, f"Invalid contact data: {data}")
                        return
                else:
                    self.log_result("Create Emergency Contacts", False, f"HTTP {response.status_code}: {response.text}")
                    return
            except Exception as e:
                self.log_result("Create Emergency Contacts", False, f"Request failed: {str(e)}")
                return
        
        if created_contacts == 2:
            self.log_result("Create Emergency Contacts", True, f"Created {created_contacts} emergency contacts")
        else:
            self.log_result("Create Emergency Contacts", False, f"Only created {created_contacts}/2 contacts")
    
    def test_get_emergency_contacts(self):
        """Test emergency contact retrieval"""
        if not self.test_user_id:
            self.log_result("Get Emergency Contacts", False, "No test user ID available")
            return
            
        try:
            response = requests.get(f"{self.base_url}/emergency-contacts/{self.test_user_id}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) >= 1:
                    # Check if contacts are sorted by priority
                    priorities = [contact.get("priority", 999) for contact in data]
                    if priorities == sorted(priorities):
                        self.log_result("Get Emergency Contacts", True, f"Retrieved {len(data)} contacts in priority order", data)
                    else:
                        self.log_result("Get Emergency Contacts", False, f"Contacts not sorted by priority: {priorities}")
                else:
                    self.log_result("Get Emergency Contacts", False, f"Expected list of contacts, got: {data}")
            else:
                self.log_result("Get Emergency Contacts", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Get Emergency Contacts", False, f"Request failed: {str(e)}")
    
    def test_delete_emergency_contact(self):
        """Test emergency contact deletion"""
        if not self.test_contact_id:
            self.log_result("Delete Emergency Contact", False, "No test contact ID available")
            return
            
        try:
            response = requests.delete(f"{self.base_url}/emergency-contacts/{self.test_contact_id}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "message" in data and "deleted" in data["message"].lower():
                    self.log_result("Delete Emergency Contact", True, f"Contact deleted: {data['message']}")
                else:
                    self.log_result("Delete Emergency Contact", False, f"Unexpected response: {data}")
            else:
                self.log_result("Delete Emergency Contact", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Delete Emergency Contact", False, f"Request failed: {str(e)}")
    
    def test_create_navigation_session(self):
        """Test navigation session creation"""
        if not self.test_user_id:
            self.log_result("Create Navigation Session", False, "No test user ID available")
            return
            
        try:
            session_data = {
                "user_id": self.test_user_id,
                "start_location": {
                    "latitude": 37.7749,
                    "longitude": -122.4194,
                    "address": "San Francisco, CA"
                },
                "destination": {
                    "latitude": 37.7849,
                    "longitude": -122.4094,
                    "address": "Union Square, San Francisco"
                },
                "destination_name": "Union Square",
                "mode": "online"
            }
            response = requests.post(f"{self.base_url}/navigation-sessions", json=session_data, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "id" in data and data.get("user_id") == self.test_user_id:
                    self.test_session_id = data["id"]
                    self.log_result("Create Navigation Session", True, f"Session created with ID: {self.test_session_id}", data)
                else:
                    self.log_result("Create Navigation Session", False, f"Invalid session data: {data}")
            else:
                self.log_result("Create Navigation Session", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Create Navigation Session", False, f"Request failed: {str(e)}")
    
    def test_get_navigation_session(self):
        """Test navigation session retrieval"""
        if not self.test_session_id:
            self.log_result("Get Navigation Session", False, "No test session ID available")
            return
            
        try:
            response = requests.get(f"{self.base_url}/navigation-sessions/{self.test_session_id}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get("id") == self.test_session_id and "status" in data:
                    self.log_result("Get Navigation Session", True, f"Retrieved session with status: {data['status']}", data)
                else:
                    self.log_result("Get Navigation Session", False, f"Session data mismatch: {data}")
            else:
                self.log_result("Get Navigation Session", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Get Navigation Session", False, f"Request failed: {str(e)}")
    
    def test_update_navigation_session(self):
        """Test navigation session update"""
        if not self.test_session_id:
            self.log_result("Update Navigation Session", False, "No test session ID available")
            return
            
        try:
            # Note: The API expects status as a query parameter, not in request body
            response = requests.patch(f"{self.base_url}/navigation-sessions/{self.test_session_id}?status=completed", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "message" in data and "updated" in data["message"].lower():
                    self.log_result("Update Navigation Session", True, f"Session updated: {data['message']}")
                else:
                    self.log_result("Update Navigation Session", False, f"Unexpected response: {data}")
            else:
                self.log_result("Update Navigation Session", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Update Navigation Session", False, f"Request failed: {str(e)}")
    
    def test_get_user_navigation_sessions(self):
        """Test user navigation sessions retrieval"""
        if not self.test_user_id:
            self.log_result("Get User Navigation Sessions", False, "No test user ID available")
            return
            
        try:
            response = requests.get(f"{self.base_url}/navigation-sessions/user/{self.test_user_id}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) >= 1:
                    self.log_result("Get User Navigation Sessions", True, f"Retrieved {len(data)} sessions for user", data)
                else:
                    self.log_result("Get User Navigation Sessions", False, f"Expected list of sessions, got: {data}")
            else:
                self.log_result("Get User Navigation Sessions", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Get User Navigation Sessions", False, f"Request failed: {str(e)}")
    
    def test_create_location_log(self):
        """Test single location log creation"""
        if not self.test_user_id:
            self.log_result("Create Location Log", False, "No test user ID available")
            return
            
        try:
            log_data = {
                "user_id": self.test_user_id,
                "session_id": self.test_session_id,
                "latitude": 37.7749,
                "longitude": -122.4194,
                "accuracy": 5.0
            }
            response = requests.post(f"{self.base_url}/location-logs", json=log_data, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "id" in data and data.get("user_id") == self.test_user_id:
                    self.log_result("Create Location Log", True, f"Location log created with ID: {data['id']}", data)
                else:
                    self.log_result("Create Location Log", False, f"Invalid log data: {data}")
            else:
                self.log_result("Create Location Log", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Create Location Log", False, f"Request failed: {str(e)}")
    
    def test_create_location_logs_batch(self):
        """Test batch location log creation"""
        if not self.test_user_id:
            self.log_result("Create Location Logs Batch", False, "No test user ID available")
            return
            
        try:
            logs_data = [
                {
                    "user_id": self.test_user_id,
                    "session_id": self.test_session_id,
                    "latitude": 37.7750,
                    "longitude": -122.4195,
                    "accuracy": 3.0
                },
                {
                    "user_id": self.test_user_id,
                    "session_id": self.test_session_id,
                    "latitude": 37.7751,
                    "longitude": -122.4196,
                    "accuracy": 4.0
                }
            ]
            response = requests.post(f"{self.base_url}/location-logs/batch", json=logs_data, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "message" in data and "2" in data["message"]:
                    self.log_result("Create Location Logs Batch", True, f"Batch created: {data['message']}")
                else:
                    self.log_result("Create Location Logs Batch", False, f"Unexpected response: {data}")
            else:
                self.log_result("Create Location Logs Batch", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Create Location Logs Batch", False, f"Request failed: {str(e)}")
    
    def test_create_alert(self):
        """Test alert creation"""
        if not self.test_user_id:
            self.log_result("Create Alert", False, "No test user ID available")
            return
            
        try:
            alert_data = {
                "user_id": self.test_user_id,
                "session_id": self.test_session_id,
                "alert_type": "obstacle",
                "message": "Large obstacle detected ahead - construction barrier",
                "location": {
                    "latitude": 37.7749,
                    "longitude": -122.4194
                },
                "priority": "high"
            }
            response = requests.post(f"{self.base_url}/alerts", json=alert_data, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "id" in data and data.get("user_id") == self.test_user_id:
                    self.log_result("Create Alert", True, f"Alert created with ID: {data['id']}", data)
                else:
                    self.log_result("Create Alert", False, f"Invalid alert data: {data}")
            else:
                self.log_result("Create Alert", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Create Alert", False, f"Request failed: {str(e)}")
    
    def test_get_user_alerts(self):
        """Test user alerts retrieval"""
        if not self.test_user_id:
            self.log_result("Get User Alerts", False, "No test user ID available")
            return
            
        try:
            response = requests.get(f"{self.base_url}/alerts/user/{self.test_user_id}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Get User Alerts", True, f"Retrieved {len(data)} alerts for user", data)
                else:
                    self.log_result("Get User Alerts", False, f"Expected list of alerts, got: {data}")
            else:
                self.log_result("Get User Alerts", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Get User Alerts", False, f"Request failed: {str(e)}")
    
    def test_trigger_emergency_alert(self):
        """Test emergency alert trigger"""
        if not self.test_user_id:
            self.log_result("Trigger Emergency Alert", False, "No test user ID available")
            return
            
        try:
            alert_data = {
                "user_id": self.test_user_id,
                "latitude": 37.7749,
                "longitude": -122.4194,
                "message": "Emergency assistance needed - fallen and unable to get up"
            }
            response = requests.post(f"{self.base_url}/emergency-alert", json=alert_data, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "id" in data and data.get("user_id") == self.test_user_id:
                    self.log_result("Trigger Emergency Alert", True, f"Emergency alert created with ID: {data['id']}", data)
                else:
                    self.log_result("Trigger Emergency Alert", False, f"Invalid emergency alert data: {data}")
            else:
                self.log_result("Trigger Emergency Alert", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Trigger Emergency Alert", False, f"Request failed: {str(e)}")
    
    def test_get_user_emergency_alerts(self):
        """Test user emergency alerts retrieval"""
        if not self.test_user_id:
            self.log_result("Get User Emergency Alerts", False, "No test user ID available")
            return
            
        try:
            response = requests.get(f"{self.base_url}/emergency-alert/user/{self.test_user_id}", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Get User Emergency Alerts", True, f"Retrieved {len(data)} emergency alerts for user", data)
                else:
                    self.log_result("Get User Emergency Alerts", False, f"Expected list of emergency alerts, got: {data}")
            else:
                self.log_result("Get User Emergency Alerts", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Get User Emergency Alerts", False, f"Request failed: {str(e)}")
    
    def test_detect_obstacles(self):
        """Test AI obstacle detection"""
        if not self.test_user_id:
            self.log_result("AI Obstacle Detection", False, "No test user ID available")
            return
            
        # Create test image
        test_image_base64 = self.create_test_image_base64()
        if not test_image_base64:
            self.log_result("AI Obstacle Detection", False, "Failed to create test image")
            return
            
        try:
            detection_data = {
                "image_base64": test_image_base64,
                "user_id": self.test_user_id,
                "session_id": self.test_session_id,
                "latitude": 37.7749,
                "longitude": -122.4194
            }
            response = requests.post(f"{self.base_url}/detect-obstacles", json=detection_data, timeout=30)
            if response.status_code == 200:
                data = response.json()
                required_fields = ["obstacles", "safe_direction", "warning_level", "audio_message"]
                if all(field in data for field in required_fields):
                    self.log_result("AI Obstacle Detection", True, f"Obstacle detection successful - Warning: {data['warning_level']}, Direction: {data['safe_direction']}", data)
                else:
                    missing_fields = [field for field in required_fields if field not in data]
                    self.log_result("AI Obstacle Detection", False, f"Missing required fields: {missing_fields}")
            else:
                self.log_result("AI Obstacle Detection", False, f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("AI Obstacle Detection", False, f"Request failed: {str(e)}")
    
    def run_all_tests(self):
        """Run all API tests in sequence"""
        print("🚀 Starting Eye Guide Navigation System API Tests")
        print(f"📡 Testing against: {self.base_url}")
        print("=" * 60)
        
        # Health check first
        self.test_health_check()
        
        # User management
        self.test_create_user()
        self.test_get_user()
        
        # Emergency contacts
        self.test_create_emergency_contacts()
        self.test_get_emergency_contacts()
        self.test_delete_emergency_contact()
        
        # Navigation sessions
        self.test_create_navigation_session()
        self.test_get_navigation_session()
        self.test_update_navigation_session()
        self.test_get_user_navigation_sessions()
        
        # Location logging
        self.test_create_location_log()
        self.test_create_location_logs_batch()
        
        # Alerts
        self.test_create_alert()
        self.test_get_user_alerts()
        
        # Emergency alerts
        self.test_trigger_emergency_alert()
        self.test_get_user_emergency_alerts()
        
        # AI obstacle detection
        self.test_detect_obstacles()
        
        # Summary
        self.print_summary()
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.results if result["success"])
        total = len(self.results)
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {(passed/total)*100:.1f}%")
        
        if total - passed > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.results:
                if not result["success"]:
                    print(f"  • {result['test']}: {result['message']}")
        
        print("\n✅ PASSED TESTS:")
        for result in self.results:
            if result["success"]:
                print(f"  • {result['test']}")

if __name__ == "__main__":
    tester = EyeGuideAPITester()
    tester.run_all_tests()