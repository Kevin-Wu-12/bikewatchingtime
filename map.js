mapboxgl.accessToken = 'pk.eyJ1Ijoia2V2aW53MTIiLCJhIjoiY203ZWg1d2doMGU4bzJycHFrOGcwaXUwdSJ9.VbAWd85HtWgGtf7fEKfijQ';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

// Helper function to convert coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);  // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point);  // Project to pixel coordinates
  return { cx: x, cy: y };  // Return as object for use in SVG attributes
}

// Helper function to format time
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Helper function to compute station traffic
function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips, 
    (v) => v.length, 
    (d) => d.start_station_id
  );

  // Compute arrivals
  const arrivals = d3.rollup(
    trips, 
    (v) => v.length, 
    (d) => d.end_station_id
  );

  // Update each station with the calculated values
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Helper function to convert date to minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Helper function to filter trips by time
function filterTripsByTime(trips, timeFilter) {
  return timeFilter === -1 
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        
        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
    });
}

// Wait for the map to load before adding data
map.on('load', async () => {
  // Add the Boston bike lanes data source
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  // Add the layer to visualize the Boston bike lanes
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
  });

  // Add the Cambridge bike lanes data source
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
  });

  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    // Await JSON fetch
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData); 

    let stations = jsonData.data.stations;
    console.log('Stations Array:', stations);

    // Fetch and parse the traffic data
    let trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      },
    );
    console.log('Loaded Traffic Data:', trips);

    // Compute initial station traffic
    stations = computeStationTraffic(stations, trips);
    console.log('Updated Stations Array:', stations);

    // Select the SVG element inside the map container
    const svg = d3.select('#map').select('svg');

    // Create a scale for the circle radius
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // Create a quantize scale for traffic flow
    const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);


    const circles = svg.selectAll('circle')
      .data(stations, (d) => d.short_name)  
      .enter()
      .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic)) 
      .attr('fill', 'steelblue') 
      .attr('stroke', 'white')   
      .attr('stroke-width', 1)   
      .attr('opacity', 0.6)      
      .attr('pointer-events', 'auto')
      .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic)) 
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });


    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)  
        .attr('cy', d => getCoords(d).cy); 
    }


    updatePositions();


    map.on('move', updatePositions);    
    map.on('zoom', updatePositions);    
    map.on('resize', updatePositions);   
    map.on('moveend', updatePositions); 

    function updateScatterPlot(timeFilter) {

      const filteredTrips = filterTripsByTime(trips, timeFilter);
      
      const filteredStations = computeStationTraffic(stations, filteredTrips);
      
      timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

      circles
        .data(filteredStations, (d) => d.short_name) 
        .join('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic)) 
        .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic)); 
    }

    // Handle the time filter slider
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');


    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value); 

      if (timeFilter === -1) {
        selectedTime.textContent = '';  
        anyTimeLabel.style.display = 'block';  
      } else {
        selectedTime.textContent = formatTime(timeFilter);  
        anyTimeLabel.style.display = 'none';  
      }

      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

  } catch (error) {
    console.error('Error loading JSON:', error);
  }
});

