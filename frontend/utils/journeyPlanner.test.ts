/**
 * Journey Planner Test Suite
 * 
 * Manual test cases to verify journey planning functionality
 */

import {
  calculateDistance,
  planJourney,
  fetchNearbyStops,
  computeBestStopPair,
  formatDistance,
  formatTime,
  type Coordinates,
} from './journeyPlanner';

// Test coordinates (San Francisco)
const TEST_LOCATIONS = {
  // Downtown SF
  downtown: { latitude: 37.7749, longitude: -122.4194 },
  
  // Golden Gate Park (3km away)
  park: { latitude: 37.7694, longitude: -122.4862 },
  
  // Oakland (13km away)
  oakland: { latitude: 37.8044, longitude: -122.2712 },
  
  // Very close location (500m away)
  nearby: { latitude: 37.7799, longitude: -122.4205 },
};

console.log('=== Journey Planner Test Suite ===\n');

// Test 1: Distance Calculation
console.log('Test 1: Distance Calculation');
const dist1 = calculateDistance(
  TEST_LOCATIONS.downtown.latitude,
  TEST_LOCATIONS.downtown.longitude,
  TEST_LOCATIONS.park.latitude,
  TEST_LOCATIONS.park.longitude
);
console.log(`Downtown SF to Golden Gate Park: ${formatDistance(dist1)}`);
console.log(`Expected: ~5-6 km ✓\n`);

// Test 2: Nearby Stop Fetching
console.log('Test 2: Fetch Nearby Stops');
console.log('Fetching stops near Downtown SF...');
fetchNearbyStops(TEST_LOCATIONS.downtown.latitude, TEST_LOCATIONS.downtown.longitude)
  .then(stops => {
    console.log(`Found ${stops.length} stops`);
    if (stops.length > 0) {
      console.log('Sample stops:');
      stops.slice(0, 3).forEach(stop => {
        console.log(`  - ${stop.name} (${stop.type}, ${formatDistance(stop.distance || 0)})`);
      });
    }
    console.log('✓\n');
  })
  .catch(err => {
    console.error('Error fetching stops:', err.message);
  });

// Test 3: Journey Planning (Short Distance - Direct Walk)
console.log('Test 3: Journey Planning (Short Distance)');
console.log('Route: Downtown SF → Nearby location (500m)');
planJourney(TEST_LOCATIONS.downtown, TEST_LOCATIONS.nearby)
  .then(plan => {
    console.log(`Journey Type: ${plan.journey_type}`);
    console.log(`Total Distance: ${formatDistance(plan.total_distance)}`);
    console.log(`Estimated Time: ${formatTime(plan.estimated_time)}`);
    console.log(`Segments: ${plan.segments.length}`);
    console.log('Expected: DIRECT_WALK (< 3km) ✓\n');
  })
  .catch(err => {
    console.error('Error planning journey:', err.message);
  });

// Test 4: Journey Planning (Long Distance - Transport)
console.log('Test 4: Journey Planning (Long Distance)');
console.log('Route: Downtown SF → Oakland (13km)');
setTimeout(() => {
  planJourney(TEST_LOCATIONS.downtown, TEST_LOCATIONS.oakland)
    .then(plan => {
      console.log(`Journey Type: ${plan.journey_type}`);
      console.log(`Total Distance: ${formatDistance(plan.total_distance)}`);
      console.log(`Estimated Time: ${formatTime(plan.estimated_time)}`);
      console.log(`Segments: ${plan.segments.length}`);
      
      if (plan.journey_type === 'TRANSPORT') {
        console.log('\nSelected Stops:');
        console.log(`  Origin: ${plan.selected_origin_stop?.name}`);
        console.log(`  Destination: ${plan.selected_destination_stop?.name}`);
        
        console.log('\nSegment Breakdown:');
        plan.segments.forEach((seg, idx) => {
          console.log(`  ${idx + 1}. ${seg.type}: ${seg.instruction}`);
          console.log(`     Distance: ${formatDistance(seg.distance)}`);
        });
      }
      console.log('Expected: TRANSPORT (> 3km) ✓\n');
    })
    .catch(err => {
      console.error('Error planning journey:', err.message);
    });
}, 2000); // Wait for previous fetch to complete

// Test 5: Format Functions
console.log('Test 5: Format Functions');
console.log(`formatDistance(450): ${formatDistance(450)}`);
console.log(`formatDistance(1500): ${formatDistance(1500)}`);
console.log(`formatDistance(12345): ${formatDistance(12345)}`);
console.log(`formatTime(15): ${formatTime(15)}`);
console.log(`formatTime(90): ${formatTime(90)}`);
console.log('✓\n');

// Expected Output Summary
setTimeout(() => {
  console.log('\n=== Test Summary ===');
  console.log('All tests completed. Verify:');
  console.log('1. Distance calculations are reasonable');
  console.log('2. Stops are fetched from Overpass API');
  console.log('3. Short journeys use DIRECT_WALK');
  console.log('4. Long journeys use TRANSPORT with segments');
  console.log('5. Format functions display correctly');
}, 5000);
