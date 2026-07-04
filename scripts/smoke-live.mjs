import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/ryancardin/Src/McpServer/NOAA/dist/index.js'],
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log(`TOOLS (${tools.tools.length}):`, tools.tools.map((t) => t.name).join(', '));

const resources = await client.listResources();
console.log(`RESOURCES (${resources.resources.length}):`, resources.resources.map((r) => r.uri).join(', '));

const prompts = await client.listPrompts();
console.log(`PROMPTS (${prompts.prompts.length}):`, prompts.prompts.map((p) => p.name).join(', '));

async function call(name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    console.log(`\n=== ${name} ${result.isError ? '[ERROR]' : '[OK]'}`);
    console.log(text.slice(0, 700));
  } catch (e) {
    console.log(`\n=== ${name} [THREW]`, e.message?.slice(0, 300));
  }
}

// Data API
await call('noaa_get_water_levels', { station: '8454000', date: 'latest' });
await call('noaa_get_tide_predictions', { station: '9414290', begin_date: '2026-07-04', end_date: '2026-07-05', interval: 'hilo' });
await call('noaa_get_water_level_summaries', { station: '8454000', product: 'high_low', begin_date: '2026-06-01', end_date: '2026-06-08' });
await call('noaa_get_water_level_summaries', { station: '9075014', product: 'daily_mean', begin_date: '2026-06-01', end_date: '2026-06-15', datum: 'IGLD' });
await call('noaa_get_currents', { station: 'bh0101', date: 'recent' });
await call('noaa_get_current_predictions', { station: 'cb0102', begin_date: '2026-07-04', end_date: '2026-07-05', interval: 'max_slack' });
await call('noaa_get_meteorological_data', { station: '8454000', product: 'wind', date: 'latest' });
await call('noaa_get_meteorological_data', { station: '8454000', product: 'water_temperature', date: 'latest', units: 'metric' });

// Validation failures (should be actionable errors, not upstream junk)
await call('noaa_get_water_levels', { station: '8454000', begin_date: '2026-01-01', end_date: '2026-03-15' });
await call('noaa_get_water_levels', { station: '8454000' });
await call('noaa_get_tide_predictions', { station: '9075014', date: 'today' }); // Great Lakes -> upstream error w/ hint

// Metadata
await call('noaa_search_stations', { name: 'San Francisco', type: 'waterlevels' });
await call('noaa_find_nearest_stations', { latitude: 42.35, longitude: -71.05, type: 'tidepredictions', limit: 5 });
await call('noaa_get_station_info', { station: '8454000', expand: ['sensors', 'floodlevels'] });
await call('noaa_get_station_datums', { station: '8454000' });
await call('noaa_get_harmonic_constituents', { station: '8454000' });
await call('noaa_get_prediction_offsets', { station: '8447930', kind: 'tide' });

// DPAPI
await call('noaa_get_sea_level_trends', { station: '8454000' });
await call('noaa_get_extreme_water_levels', { station: '8454000' });
await call('noaa_get_top_ten_water_levels', { station: '8454000' });
await call('noaa_get_high_tide_flooding', { station: '8454000', report: 'annual', range: 5 });
await call('noaa_get_sea_level_rise_projections', { station: '8454000', scenario: 'intermediate', projection_year: 2050 });

// Astronomy
await call('astro_get_moon_phase', { date: '2026-07-04' });
await call('astro_get_next_moon_phase', { phase: 'Full Moon', date: '2026-07-04', count: 2 });
await call('astro_get_sun_times', { latitude: 41.8, longitude: -71.4, date: '2026-07-04', timezone: 'America/New_York' });
await call('astro_get_next_sun_event', { event: 'goldenHourStart', latitude: 41.8, longitude: -71.4, date: '2026-07-04' });

// Reference + resources + prompts
await call('noaa_get_reference_guide', { topic: 'units' });
const res = await client.readResource({ uri: 'noaa://reference/datums' });
console.log('\n=== resource noaa://reference/datums [OK]');
console.log(res.contents[0].text.slice(0, 300));
const prompt = await client.getPrompt({ name: 'tide_report', arguments: { location: 'Boston', date: '2026-07-10' } });
console.log('\n=== prompt tide_report [OK]');
console.log(prompt.messages[0].content.text.slice(0, 200));

await client.close();
console.log('\nSMOKE TEST COMPLETE');
