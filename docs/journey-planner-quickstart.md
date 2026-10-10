# Quick Start Guide: Journey Planning Feature

## For Developers

### How to Use the Journey Planner

#### 1. Import the Module

```typescript
import {
  planJourney,
  calculateDistance,
  fetchNearbyStops,
  formatDistance,
  formatTime,
  generateAudioInstruction,
  type JourneyPlan,
  type NavigationSegment,
  type Coordinates,
} from '@/utils/journeyPlanner';
```

#### 2. Plan a Journey

```typescript
const userLocation: Coordinates = {
  latitude: 37.7749,
  longitude: -122.4194
};

const destination: Coordinates = {
  latitude: 37.8044,
  longitude: -122.2712
};

const journey: JourneyPlan = await planJourney(userLocation, destination);

console.log(journey);
// Output:
// {
//   origin_coordinates: {...},
//   destination_coordinates: {...},
//   selected_origin_stop: {...},
//   selected_destination_stop: {...},
//   segments: [...],
//   total_distance: 12345,
//   estimated_time: 45,
//   journey_type: "TRANSPORT"
// }
```

#### 3. Access Segments

```typescript
journey.segments.forEach((segment, index) => {
  console.log(`Segment ${index + 1}:`);
  console.log(`  Type: ${segment.type}`);
  console.log(`  Instruction: ${segment.instruction}`);
  console.log(`  Distance: ${formatDistance(segment.distance)}`);
  console.log(`  Audio: ${generateAudioInstruction(segment)}`);
});
```

#### 4. Create Navigation Session with Journey Plan

```typescript
const sessionData = {
  user_id: userId,
  start_location: userLocation,
  destination: destination,
  destination_name: "Oakland Station",
  journey_plan: journey, // Include full journey plan
  current_segment_index: 0,
  mode: "online"
};

const response = await axios.post(
  `${BACKEND_URL}/api/navigation-sessions`,
  sessionData
);

const session = response.data;
```

#### 5. Track Segment Progress

```typescript
// Get current segment
const currentSegment = journey.segments[session.current_segment_index];

// Calculate distance to segment endpoint
const distanceRemaining = calculateDistance(
  currentLocation.latitude,
  currentLocation.longitude,
  currentSegment.end_coordinates.latitude,
  currentSegment.end_coordinates.longitude
);

// Check if segment is complete (within 50m threshold)
if (distanceRemaining <= 50) {
  // Advance to next segment
  await axios.patch(
    `${BACKEND_URL}/api/navigation-sessions/${session.id}`,
    null,
    { params: { current_segment_index: session.current_segment_index + 1 } }
  );
}
```

---

## For End Users

### How to Navigate to a Destination

#### Step 1: Open Navigation Screen
- From home screen, tap **"Navigate"** button
- Your current location will be detected automatically

#### Step 2: Enter Destination
- In the **"Where do you want to go?"** field, enter:
  - Street address: "123 Main Street"
  - Place name: "Central Station"
  - Landmark: "Golden Gate Bridge"
- Tap **"Plan Journey"** button

#### Step 3: Review Journey Plan
- System will show:
  - **Total Distance** and **Estimated Time**
  - **Segment Cards** for each step:
    - Segment 1: Walk to bus stop
    - Segment 2: Take Bus/Train
    - Segment 3: Walk to destination
- Voice announcement of complete route

#### Step 4: Start Navigation
- Tap **"Start Navigation"** button
- Camera opens with live guidance
- Current segment shown at bottom of screen

#### Step 5: Follow Segments
- **Walk Segments**: Camera + obstacle detection active
- **Transport Segments**: System monitors your location
- Progress bar shows completion percentage
- Automatic transition to next segment when close

#### Step 6: Arrival
- Voice announces: "Navigation complete. You have arrived."
- Navigation session automatically ends

---

## Voice Commands & Accessibility

### Available Audio Cues

**During Planning:**
- "Searching for destination"
- "Found [location name]. Distance [X]. Planning journey."
- "Journey planned with 3 segments. Using [stop name] to [stop name]."

**During Navigation:**
- "Walk to [stop name]. Distance [X], approximately [time]."
- "Take Bus from [stop] to [stop]. Journey [X], approximately [time]."
- "Segment complete. Starting next segment."
- "Navigation complete. You have arrived at your destination."

### Long-Press for Details
- **Journey Cards**: Long-press for audio description
- **Buttons**: Long-press to hear button function

---

## Troubleshooting

### "Destination not found"
**Solution:** Try different search terms:
- Add city name: "Central Station, San Francisco"
- Use full address: "123 Main St, Oakland, CA"
- Try nearby landmark

### "No transport stops found"
**Solution:** System will use direct walk navigation automatically.
- Works for destinations < 3km away
- You can still navigate with camera guidance

### "Unable to plan journey"
**Possible Causes:**
- No internet connection (check WiFi/data)
- GPS not available (go outdoors)
- Overpass API temporarily down

**Solution:** Retry after a moment, or use direct walk mode

### Segment Not Completing
**If stuck on segment:**
- Ensure you're walking toward the endpoint
- Check if within 50m of destination
- Manual override: Tap back and restart navigation

---

## Configuration Options

### Adjust Search Radius
In `journeyPlanner.ts`, modify:
```typescript
const DEFAULT_SEARCH_RADIUS = 800; // Change to 500-1200m
```

### Change Direct Walk Threshold
```typescript
const MAX_WALKING_DISTANCE = 3000; // Change to prefer walking or transport
```

### Adjust Segment Completion Distance
In `camera.tsx`, modify:
```typescript
const SEGMENT_COMPLETION_THRESHOLD = 50; // Change to 20-100m
```

---

## API Reference

### Journey Planner Functions

#### `planJourney(origin, destination): Promise<JourneyPlan>`
Main function to compute complete journey.

**Parameters:**
- `origin: Coordinates` - User's current GPS location
- `destination: Coordinates` - Target GPS location

**Returns:** Full journey plan with segments

**Example:**
```typescript
const plan = await planJourney(
  { latitude: 37.7749, longitude: -122.4194 },
  { latitude: 37.8044, longitude: -122.2712 }
);
```

---

#### `fetchNearbyStops(lat, lon, radius?): Promise<TransportStop[]>`
Fetch transport stops from OpenStreetMap.

**Parameters:**
- `lat: number` - Latitude
- `lon: number` - Longitude
- `radius?: number` - Search radius (default: 800m)

**Returns:** Array of transport stops

---

#### `calculateDistance(lat1, lon1, lat2, lon2): number`
Calculate distance between two points using Haversine formula.

**Returns:** Distance in meters

---

#### `formatDistance(meters): string`
Format distance for display.

**Examples:**
- `450` → "450m"
- `1500` → "1.5km"

---

#### `formatTime(minutes): string`
Format time for display.

**Examples:**
- `15` → "15 min"
- `90` → "1h 30min"

---

#### `generateAudioInstruction(segment): string`
Generate voice instruction for segment.

**Returns:** Complete audio message with distance and time

---

### Backend API Endpoints

#### `POST /api/navigation-sessions`
Create new navigation session with journey plan.

**Body:**
```json
{
  "user_id": "demo_user",
  "start_location": {"latitude": 37.7749, "longitude": -122.4194},
  "destination": {"latitude": 37.8044, "longitude": -122.2712},
  "destination_name": "Oakland",
  "journey_plan": { ... },
  "current_segment_index": 0,
  "mode": "online"
}
```

---

#### `PATCH /api/navigation-sessions/{session_id}`
Update navigation session progress.

**Query Parameters:**
- `status?: string` - "active", "completed", "cancelled"
- `current_segment_index?: int` - Advance to next segment

**Example:**
```
PATCH /api/navigation-sessions/abc123?current_segment_index=1
```

---

## Examples

### Example 1: Complete Journey Flow

```typescript
// 1. Get user location
const userLocation = await getCurrentLocation();

// 2. Geocode destination
const destCoords = await geocodeAddress("Central Station");

// 3. Plan journey
const journey = await planJourney(userLocation, destCoords);

// 4. Create session
const session = await createNavigationSession({
  user_id: "user123",
  start_location: userLocation,
  destination: destCoords,
  destination_name: "Central Station",
  journey_plan: journey,
  current_segment_index: 0
});

// 5. Start first segment
const firstSegment = journey.segments[0];
Speech.speak(generateAudioInstruction(firstSegment));

// 6. Monitor progress
setInterval(async () => {
  const current = await getCurrentLocation();
  const distance = calculateDistance(
    current.latitude,
    current.longitude,
    firstSegment.end_coordinates.latitude,
    firstSegment.end_coordinates.longitude
  );
  
  if (distance <= 50) {
    await advanceToNextSegment(session.id);
  }
}, 5000);
```

---

### Example 2: Direct Walk Fallback

```typescript
const journey = await planJourney(userLocation, nearbyDestination);

if (journey.journey_type === "DIRECT_WALK") {
  // Only one segment - direct walk
  Speech.speak("Direct walk recommended.");
  Speech.speak(journey.segments[0].instruction);
} else {
  // Multi-segment journey
  Speech.speak(`Journey has ${journey.segments.length} segments.`);
}
```

---

## Testing Checklist

- [ ] Destination geocoding works
- [ ] Stops fetched from Overpass API
- [ ] Short distances use direct walk
- [ ] Long distances use transport
- [ ] Segments display correctly
- [ ] Voice instructions work
- [ ] Progress tracking functions
- [ ] Segment auto-advances
- [ ] Journey completes successfully
- [ ] Fallback to direct walk works
- [ ] Backend session stores journey_plan
- [ ] Segment updates persist to backend

---

## Support

For issues or questions:
1. Check error logs in browser console
2. Verify backend is running on port 8001
3. Test with known locations (e.g., major transit stations)
4. Review JOURNEY_PLANNER_DOCS.md for detailed documentation

---

## Version

**Current Version:** 1.0.0  
**Last Updated:** February 23, 2026  
**Status:** Production Ready ✅
