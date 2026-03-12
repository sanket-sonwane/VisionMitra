# System Architecture Diagram

## Complete Journey Planning Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  HOME SCREEN (index.tsx)                                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │   Camera   │  │  Navigate  │  │ Emergency  │  │  Settings  │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌─────────────────────────────────────┐  ┌────────────────────────┐
│  NAVIGATE SCREEN (navigate.tsx)     │  │ CAMERA SCREEN          │
│  ┌─────────────────────────────┐    │  │ (camera.tsx)           │
│  │ 1. Get Current Location     │    │  │ ┌────────────────────┐ │
│  │    └─> GPS Coordinates      │    │  │ │ Live Camera Feed   │ │
│  └─────────────────────────────┘    │  │ │ + Obstacle Detect  │ │
│                                      │  │ └────────────────────┘ │
│  ┌─────────────────────────────┐    │  │ ┌────────────────────┐ │
│  │ 2. Enter Destination        │    │  │ │ Segment Overlay    │ │
│  │    └─> Text Input Field     │    │  │ │  - Current Segment │ │
│  └─────────────────────────────┘    │  │ │  - Progress Bar    │ │
│           │                          │  │ │  - Distance/Time   │ │
│           ▼                          │  │ └────────────────────┘ │
│  ┌─────────────────────────────┐    │  │ ┌────────────────────┐ │
│  │ 3. Geocode via Nominatim    │    │  │ │ Location Tracking  │ │
│  │    └─> Get GPS Coordinates  │    │  │ │  └─> Auto Advance  │ │
│  └─────────────────────────────┘    │  │ └────────────────────┘ │
│           │                          │  └────────────────────────┘
│           ▼                          │
│  ┌─────────────────────────────┐    │
│  │ 4. Plan Journey              │    │
│  │    └─> journeyPlanner.ts    │    │
│  └─────────────────────────────┘    │
│           │                          │
│           ▼                          │
│  ┌─────────────────────────────┐    │
│  │ 5. Display Journey Plan      │    │
│  │    - Summary Card            │    │
│  │    - Segment Cards           │    │
│  │    - Distance/Time           │    │
│  └─────────────────────────────┘    │
│           │                          │
│           ▼                          │
│  ┌─────────────────────────────┐    │
│  │ 6. Start Navigation          │────┼──────────────────────────┐
│  │    └─> Create Session        │    │                          │
│  └─────────────────────────────┘    │                          │
└─────────────────────────────────────┘                          │
                                                                  │
┌─────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────┐
│  JOURNEY PLANNER MODULE (utils/journeyPlanner.ts)                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  planJourney(origin, destination)                           │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │ Step 1: Fetch Stops Near Origin                   │     │   │
│  │  │   └─> Overpass API Query (800m radius)            │     │   │
│  │  │       - bus_stop                                   │     │   │
│  │  │       - railway=station                            │     │   │
│  │  │       - railway=tram_stop                          │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  │            │                                                 │   │
│  │            ▼                                                 │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │ Step 2: Fetch Stops Near Destination              │     │   │
│  │  │   └─> Overpass API Query (800m radius)            │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  │            │                                                 │   │
│  │            ▼                                                 │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │ Step 3: Compute Best Stop Pair                    │     │   │
│  │  │   FOR each (origin_stop, dest_stop):              │     │   │
│  │  │     cost = dist(user→origin)                      │     │   │
│  │  │          + dist(origin→dest)                      │     │   │
│  │  │          + dist(dest→destination)                 │     │   │
│  │  │   SELECT pair with MIN cost                        │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  │            │                                                 │   │
│  │            ▼                                                 │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │ Step 4: Build Segments                            │     │   │
│  │  │   Segment 1: WALK (user → origin_stop)            │     │   │
│  │  │   Segment 2: TRANSPORT (origin → dest_stop)       │     │   │
│  │  │   Segment 3: WALK (dest_stop → destination)       │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  │            │                                                 │   │
│  │            ▼                                                 │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │ Step 5: Return JourneyPlan                        │     │   │
│  │  │   - origin_coordinates                             │     │   │
│  │  │   - destination_coordinates                        │     │   │
│  │  │   - selected_origin_stop                           │     │   │
│  │  │   - selected_destination_stop                      │     │   │
│  │  │   - segments[]                                     │     │   │
│  │  │   - total_distance                                 │     │   │
│  │  │   - estimated_time                                 │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  FALLBACK: If no stops or destination < 3km                        │
│  └─> buildDirectWalkSegment() → Single WALK segment               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND API (backend/server.py)                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  POST /api/navigation-sessions                              │   │
│  │  {                                                           │   │
│  │    user_id: "demo_user",                                    │   │
│  │    start_location: {lat, lon},                              │   │
│  │    destination: {lat, lon},                                 │   │
│  │    destination_name: "Central Station",                     │   │
│  │    journey_plan: { ... },  ← FULL JOURNEY PLAN             │   │
│  │    current_segment_index: 0  ← TRACK PROGRESS              │   │
│  │  }                                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                  │                                  │
│                                  ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  MongoDB Storage (navigation_sessions collection)           │   │
│  │  - Session ID                                               │   │
│  │  - User ID                                                  │   │
│  │  - Journey Plan (full object)                               │   │
│  │  - Current Segment Index                                    │   │
│  │  - Status (active/completed/cancelled)                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  PATCH /api/navigation-sessions/{id}                        │   │
│  │  ?current_segment_index=1  ← UPDATE PROGRESS                │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EXTERNAL APIS (Free & Open Source)                                │
│  ┌───────────────────────────────┐  ┌──────────────────────────┐  │
│  │ OpenStreetMap Overpass API    │  │ Nominatim Geocoding      │  │
│  │ - Transport stop data         │  │ - Address → Coordinates  │  │
│  │ - Bus stops                   │  │ - Place name search      │  │
│  │ - Train stations              │  │ - Free tier              │  │
│  │ - Tram stops                  │  │                          │  │
│  └───────────────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Segment Execution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  CAMERA SCREEN - SEGMENTED NAVIGATION                               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
        ┌───────────────────────┐   ┌───────────────────────┐
        │  Location Tracking    │   │  Obstacle Detection   │
        │  (Every 5 seconds)    │   │  (Every 3 seconds)    │
        └───────────────────────┘   └───────────────────────┘
                    │                           │
                    ▼                           ▼
        ┌───────────────────────┐   ┌───────────────────────┐
        │  Calculate Distance   │   │  YOLO Analysis        │
        │  to Segment Endpoint  │   │  - Detect obstacles   │
        └───────────────────────┘   │  - Warning level      │
                    │                │  - Safe direction     │
                    ▼                └───────────────────────┘
        ┌───────────────────────┐               │
        │  Update Progress Bar  │               ▼
        │  (% completion)       │   ┌───────────────────────┐
        └───────────────────────┘   │  Voice Announcement   │
                    │                │  + Haptic Feedback    │
                    ▼                └───────────────────────┘
        ┌───────────────────────┐
        │  Distance < 50m?      │
        └───────────────────────┘
                    │
         ┌──────────┴──────────┐
         │ NO                  │ YES
         ▼                     ▼
    Continue          ┌───────────────────────┐
    Monitoring        │  Complete Segment     │
                      └───────────────────────┘
                                  │
                      ┌───────────┴───────────┐
                      │                       │
                      ▼                       ▼
          ┌───────────────────┐   ┌──────────────────────┐
          │ More Segments?    │   │ Update Backend       │
          └───────────────────┘   │ (segment_index++)    │
                      │            └──────────────────────┘
         ┌────────────┴────────────┐
         │ YES                     │ NO
         ▼                         ▼
┌──────────────────┐     ┌─────────────────────┐
│ Advance to Next  │     │ Complete Journey    │
│ Segment          │     │ - Voice: "Arrived"  │
│ - Voice announce │     │ - Haptic feedback   │
│ - Reset progress │     │ - Clear session     │
└──────────────────┘     └─────────────────────┘
         │
         └────────────┐
                      ▼
              (Back to Location
               Tracking Loop)
```

## Data Flow Diagram

```
┌──────────┐
│   USER   │
└────┬─────┘
     │ 1. Enter "Central Station"
     ▼
┌─────────────────┐
│  Navigate.tsx   │
└────┬────────────┘
     │ 2. Geocode request
     ▼
┌─────────────────┐
│  Nominatim API  │
└────┬────────────┘
     │ 3. Returns coordinates
     ▼
┌─────────────────────┐
│ journeyPlanner.ts   │
│ planJourney()       │
└────┬────────────────┘
     │ 4. Fetch origin stops
     ▼
┌─────────────────┐
│ Overpass API    │
└────┬────────────┘
     │ 5. Returns stops
     ▼
┌─────────────────────┐
│ journeyPlanner.ts   │
│ computeBestPair()   │
└────┬────────────────┘
     │ 6. Journey plan object
     ▼
┌─────────────────┐
│  Navigate.tsx   │ Display segments
└────┬────────────┘
     │ 7. User taps "Start"
     ▼
┌─────────────────┐
│  Backend API    │ POST /navigation-sessions
└────┬────────────┘
     │ 8. Session created
     ▼
┌─────────────────┐
│  MongoDB        │ Store journey_plan
└────┬────────────┘
     │ 9. Session returned
     ▼
┌─────────────────┐
│  Camera.tsx     │ Start navigation
└────┬────────────┘
     │ 10. Location updates
     ▼
┌─────────────────┐
│  GPS Location   │
└────┬────────────┘
     │ 11. Check distance
     ▼
┌─────────────────────┐
│ Segment complete?   │
└────┬────────────────┘
     │ 12. YES: Advance
     ▼
┌─────────────────┐
│  Backend API    │ PATCH /sessions/{id}
└────┬────────────┘
     │ 13. Update index
     ▼
┌─────────────────┐
│  MongoDB        │ current_segment_index++
└────┬────────────┘
     │ 14. Confirmed
     ▼
┌─────────────────┐
│  Camera.tsx     │ Load next segment
└────┬────────────┘
     │ 15. Repeat until complete
     ▼
┌──────────────────┐
│ Journey Complete │
└──────────────────┘
```

## Component Interaction Map

```
┌──────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌────────────┐  ┌─────────────┐  ┌────────────────────┐   │
│  │ index.tsx  │─→│ navigate.tsx│─→│ camera.tsx         │   │
│  │ Home       │  │ Plan Journey│  │ Execute Segments   │   │
│  └────────────┘  └──────┬──────┘  └─────────┬──────────┘   │
│                         │                    │              │
│                         ▼                    ▼              │
│           ┌─────────────────────┐  ┌──────────────────┐    │
│           │ journeyPlanner.ts   │  │ Current Location │    │
│           │ - planJourney()     │  │ - GPS Tracking   │    │
│           │ - fetchStops()      │  │ - Progress Check │    │
│           │ - computePair()     │  └──────────────────┘    │
│           └─────────────────────┘                          │
│                         │                                   │
└─────────────────────────┼───────────────────────────────────┘
                          │
              ┌───────────┴────────────┐
              │                        │
              ▼                        ▼
    ┌──────────────────┐    ┌──────────────────┐
    │  Overpass API    │    │  Nominatim API   │
    │  (Stop Data)     │    │  (Geocoding)     │
    └──────────────────┘    └──────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                        Backend                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  FastAPI Endpoints                                   │   │
│  │  - POST /navigation-sessions                         │   │
│  │  - PATCH /navigation-sessions/{id}                   │   │
│  │  - POST /detect-obstacles                            │   │
│  └──────────────┬───────────────────────────────────────┘   │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  MongoDB Collections                                 │   │
│  │  - navigation_sessions                               │   │
│  │    {                                                 │   │
│  │      journey_plan: {...},                            │   │
│  │      current_segment_index: 0                        │   │
│  │    }                                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## State Management Flow

```
┌────────────────────────────────────────────────────────────────┐
│  Zustand Store (store.ts)                                      │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  State:                                                  │ │
│  │  - userId: string                                        │ │
│  │  - isOnlineMode: boolean                                 │ │
│  │  - currentSession: {                                     │ │
│  │      id: string                                          │ │
│  │      journey_plan: JourneyPlan                           │ │
│  │      current_segment_index: number                       │ │
│  │    }                                                     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Actions:                                                │ │
│  │  - setUserId()                                           │ │
│  │  - toggleMode()                                          │ │
│  │  - setCurrentSession()  ← Update with backend response  │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
           │                             │
           │ Used by:                    │ Modified by:
           ▼                             ▼
┌──────────────────┐          ┌──────────────────────┐
│  navigate.tsx    │          │  Backend API         │
│  camera.tsx      │          │  Response            │
│  settings.tsx    │          └──────────────────────┘
└──────────────────┘
```

---

## Key Algorithms Visualized

### Cost Function (Stop Pair Selection)

```
For pair (Stop A → Stop B):

┌─────┐      d1      ┌────────┐      d2      ┌────────┐      d3      ┌──────┐
│User │──────────────│Stop A  │──────────────│Stop B  │──────────────│ Dest │
└─────┘   (walk)     └────────┘  (transport) └────────┘   (walk)     └──────┘

Cost = d1 + d2 + d3

Select pair with MINIMUM cost
```

### Progress Tracking Algorithm

```
Segment: Walk to Stop A (500m total)

Current Location: User is 350m away from Stop A

Progress = (500 - 350) / 500 × 100 = 30%

┌──────────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░                                   │ 30%
└──────────────────────────────────────────────────┘

When distance < 50m:
  → Segment Complete
  → Advance to next segment
```

---

**Diagram Version:** 1.0  
**Last Updated:** February 23, 2026  
**Status:** Complete System Architecture
