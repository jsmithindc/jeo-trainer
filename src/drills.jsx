import { useState, useEffect, useRef } from 'react'
import { saveCards, loadCards } from './storage.js'

// ─── Generate SVG snapshot of a map region ───────────────────────────────────
function makeMapSnapshot(targetPath, allPaths, viewPad = 30) {
  if (!targetPath) return null
  // Get bounding box of target path
  const coords = [...targetPath.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [+m[1], +m[2]])
  if (!coords.length) return null
  const xs = coords.map(c => c[0]), ys = coords.map(c => c[1])
  const minX = Math.min(...xs) - viewPad, maxX = Math.max(...xs) + viewPad
  const minY = Math.min(...ys) - viewPad, maxY = Math.max(...ys) + viewPad
  const w = maxX - minX, h = maxY - minY
  // Only include paths that overlap the viewport (keeps SVG small)
  const visiblePaths = allPaths.filter(p => {
    const pCoords = [...p.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [+m[1], +m[2]])
    if (!pCoords.length) return false
    const pxs = pCoords.map(c => c[0]), pys = pCoords.map(c => c[1])
    return Math.min(...pxs) < maxX && Math.max(...pxs) > minX &&
           Math.min(...pys) < maxY && Math.max(...pys) > minY
  })
  const svgPaths = visiblePaths.map(p => {
    const isTarget = p.id === targetPath.id || p.name === targetPath.name
    return `<path d="${p.d}" fill="${isTarget ? '#4dd0e1' : '#1a3070'}" stroke="#0a0f2e" stroke-width="0.5"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="240" height="${Math.round(240 * h / w)}"><rect width="960" height="500" fill="#060b1a"/>${svgPaths}</svg>`
  try { return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))) }
  catch { return null }
}

// ─── Make flashcard from missed drill item ───────────────────────────────────
function makeFlashCard(front, back, category = 'Drill') {
  return {
    id: `drill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    front,
    back,
    category,
    dueAt: Date.now(),
    interval: 1,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    lastReviewed: null,
    createdAt: Date.now(),
  }
}

// ─── Fuzzy Match ─────────────────────────────────────────────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/[.\-''']/g, '')   // remove periods, hyphens, apostrophes
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function fuzzyMatch(input, target) {
  const a = normalize(input)
  const b = normalize(target)
  if (a === b) return true
  // Accept if input exactly matches any significant word in target (e.g. last name only)
  const bWords = b.split(' ').filter(w => w.length >= 4)
  if (bWords.some(w => w === a)) return true
  // Require input to be at least 40% the length of target to avoid trivial matches
  if (a.length < 3 || a.length < b.length * 0.4) return false
  const maxDist = b.length > 8 ? 2 : b.length > 4 ? 1 : 0
  return levenshtein(a, b) <= maxDist
}

// ─── Drill Stats Storage ──────────────────────────────────────────────────────
const DRILL_STATS_KEY = 'jeo-drill-stats'

function loadDrillStats() {
  try { return JSON.parse(localStorage.getItem(DRILL_STATS_KEY) || '{}') } catch { return {} }
}

function saveDrillSession(drillId, score, total) {
  const stats = loadDrillStats()
  if (!stats[drillId]) stats[drillId] = []
  stats[drillId].unshift({ score, total, pct: Math.round(score / total * 100), date: new Date().toLocaleDateString() })
  stats[drillId] = stats[drillId].slice(0, 20)
  localStorage.setItem(DRILL_STATS_KEY, JSON.stringify(stats))
}

const DRILL_MISSES_KEY = 'jeo-drill-misses'

function loadDrillMisses() {
  try { return JSON.parse(localStorage.getItem(DRILL_MISSES_KEY) || '{}') } catch { return {} }
}

function saveDrillMisses(drillId, missedKeys) {
  // Store last 3 quiz miss sets per drill: [{keys: Set→Array, date}]
  const all = loadDrillMisses()
  if (!all[drillId]) all[drillId] = []
  all[drillId].unshift({ keys: missedKeys, date: new Date().toLocaleDateString() })
  all[drillId] = all[drillId].slice(0, 3)
  localStorage.setItem(DRILL_MISSES_KEY, JSON.stringify(all))
}

function getDrillMissCounts(drillId) {
  // Returns map of key → number of recent quizzes missed (1-3)
  const all = loadDrillMisses()
  const sessions = all[drillId] || []
  const counts = {}
  sessions.forEach(s => {
    s.keys.forEach(k => { counts[k] = (counts[k] || 0) + 1 })
  })
  return counts
}

// ─── Presidents Data ──────────────────────────────────────────────────────────
export const PRESIDENTS = [
  { num: 1, name: 'George Washington', years: '1789–1797', party: 'Unaffiliated' },
  { num: 2, name: 'John Adams', years: '1797–1801', party: 'Federalist' },
  { num: 3, name: 'Thomas Jefferson', years: '1801–1809', party: 'Democratic-Republican' },
  { num: 4, name: 'James Madison', years: '1809–1817', party: 'Democratic-Republican' },
  { num: 5, name: 'James Monroe', years: '1817–1825', party: 'Democratic-Republican' },
  { num: 6, name: 'John Quincy Adams', years: '1825–1829', party: 'Democratic-Republican' },
  { num: 7, name: 'Andrew Jackson', years: '1829–1837', party: 'Democrat' },
  { num: 8, name: 'Martin Van Buren', years: '1837–1841', party: 'Democrat' },
  { num: 9, name: 'William Henry Harrison', years: '1841', party: 'Whig' },
  { num: 10, name: 'John Tyler', years: '1841–1845', party: 'Whig' },
  { num: 11, name: 'James K. Polk', years: '1845–1849', party: 'Democrat' },
  { num: 12, name: 'Zachary Taylor', years: '1849–1850', party: 'Whig' },
  { num: 13, name: 'Millard Fillmore', years: '1850–1853', party: 'Whig' },
  { num: 14, name: 'Franklin Pierce', years: '1853–1857', party: 'Democrat' },
  { num: 15, name: 'James Buchanan', years: '1857–1861', party: 'Democrat' },
  { num: 16, name: 'Abraham Lincoln', years: '1861–1865', party: 'Republican' },
  { num: 17, name: 'Andrew Johnson', years: '1865–1869', party: 'Democrat/National Union' },
  { num: 18, name: 'Ulysses S. Grant', years: '1869–1877', party: 'Republican' },
  { num: 19, name: 'Rutherford B. Hayes', years: '1877–1881', party: 'Republican' },
  { num: 20, name: 'James A. Garfield', years: '1881', party: 'Republican' },
  { num: 21, name: 'Chester A. Arthur', years: '1881–1885', party: 'Republican' },
  { num: 22, name: 'Grover Cleveland', years: '1885–1889', party: 'Democrat' },
  { num: 23, name: 'Benjamin Harrison', years: '1889–1893', party: 'Republican' },
  { num: 24, name: 'Grover Cleveland', years: '1893–1897', party: 'Democrat' },
  { num: 25, name: 'William McKinley', years: '1897–1901', party: 'Republican' },
  { num: 26, name: 'Theodore Roosevelt', years: '1901–1909', party: 'Republican' },
  { num: 27, name: 'William Howard Taft', years: '1909–1913', party: 'Republican' },
  { num: 28, name: 'Woodrow Wilson', years: '1913–1921', party: 'Democrat' },
  { num: 29, name: 'Warren G. Harding', years: '1921–1923', party: 'Republican' },
  { num: 30, name: 'Calvin Coolidge', years: '1923–1929', party: 'Republican' },
  { num: 31, name: 'Herbert Hoover', years: '1929–1933', party: 'Republican' },
  { num: 32, name: 'Franklin D. Roosevelt', years: '1933–1945', party: 'Democrat' },
  { num: 33, name: 'Harry S. Truman', years: '1945–1953', party: 'Democrat' },
  { num: 34, name: 'Dwight D. Eisenhower', years: '1953–1961', party: 'Republican' },
  { num: 35, name: 'John F. Kennedy', years: '1961–1963', party: 'Democrat' },
  { num: 36, name: 'Lyndon B. Johnson', years: '1963–1969', party: 'Democrat' },
  { num: 37, name: 'Richard Nixon', years: '1969–1974', party: 'Republican' },
  { num: 38, name: 'Gerald Ford', years: '1974–1977', party: 'Republican' },
  { num: 39, name: 'Jimmy Carter', years: '1977–1981', party: 'Democrat' },
  { num: 40, name: 'Ronald Reagan', years: '1981–1989', party: 'Republican' },
  { num: 41, name: 'George H.W. Bush', years: '1989–1993', party: 'Republican' },
  { num: 42, name: 'Bill Clinton', years: '1993–2001', party: 'Democrat' },
  { num: 43, name: 'George W. Bush', years: '2001–2009', party: 'Republican' },
  { num: 44, name: 'Barack Obama', years: '2009–2017', party: 'Democrat' },
  { num: 45, name: 'Donald Trump', years: '2017–2021', party: 'Republican' },
  { num: 46, name: 'Joe Biden', years: '2021–2025', party: 'Democrat' },
  { num: 47, name: 'Donald Trump', years: '2025–present', party: 'Republican' },
]

// ─── World Capitals Data ──────────────────────────────────────────────────────
export const COUNTRIES = [
  { id: 'AFG', name: 'Afghanistan', capital: 'Kabul' },
  { id: 'ALB', name: 'Albania', capital: 'Tirana' },
  { id: 'DZA', name: 'Algeria', capital: 'Algiers' },
  { id: 'AND', name: 'Andorra', capital: 'Andorra la Vella' },
  { id: 'AGO', name: 'Angola', capital: 'Luanda' },
  { id: 'ATG', name: 'Antigua and Barbuda', capital: 'Saint John\'s' },
  { id: 'ARG', name: 'Argentina', capital: 'Buenos Aires' },
  { id: 'ARM', name: 'Armenia', capital: 'Yerevan' },
  { id: 'AUS', name: 'Australia', capital: 'Canberra' },
  { id: 'AUT', name: 'Austria', capital: 'Vienna' },
  { id: 'AZE', name: 'Azerbaijan', capital: 'Baku' },
  { id: 'BHS', name: 'Bahamas', capital: 'Nassau' },
  { id: 'BHR', name: 'Bahrain', capital: 'Manama' },
  { id: 'BGD', name: 'Bangladesh', capital: 'Dhaka' },
  { id: 'BRB', name: 'Barbados', capital: 'Bridgetown' },
  { id: 'BLR', name: 'Belarus', capital: 'Minsk' },
  { id: 'BEL', name: 'Belgium', capital: 'Brussels' },
  { id: 'BLZ', name: 'Belize', capital: 'Belmopan' },
  { id: 'BEN', name: 'Benin', capital: 'Porto-Novo' },
  { id: 'BTN', name: 'Bhutan', capital: 'Thimphu' },
  { id: 'BOL', name: 'Bolivia', capital: 'Sucre' },
  { id: 'BIH', name: 'Bosnia and Herzegovina', capital: 'Sarajevo' },
  { id: 'BWA', name: 'Botswana', capital: 'Gaborone' },
  { id: 'BRA', name: 'Brazil', capital: 'Brasília' },
  { id: 'BRN', name: 'Brunei', capital: 'Bandar Seri Begawan' },
  { id: 'BGR', name: 'Bulgaria', capital: 'Sofia' },
  { id: 'BFA', name: 'Burkina Faso', capital: 'Ouagadougou' },
  { id: 'BDI', name: 'Burundi', capital: 'Gitega' },
  { id: 'CPV', name: 'Cabo Verde', capital: 'Praia' },
  { id: 'KHM', name: 'Cambodia', capital: 'Phnom Penh' },
  { id: 'CMR', name: 'Cameroon', capital: 'Yaoundé' },
  { id: 'CAN', name: 'Canada', capital: 'Ottawa' },
  { id: 'CAF', name: 'Central African Republic', capital: 'Bangui' },
  { id: 'TCD', name: 'Chad', capital: 'N\'Djamena' },
  { id: 'CHL', name: 'Chile', capital: 'Santiago' },
  { id: 'CHN', name: 'China', capital: 'Beijing' },
  { id: 'COL', name: 'Colombia', capital: 'Bogotá' },
  { id: 'COM', name: 'Comoros', capital: 'Moroni' },
  { id: 'COD', name: 'Congo (DRC)', capital: 'Kinshasa' },
  { id: 'COG', name: 'Congo (Republic)', capital: 'Brazzaville' },
  { id: 'CRI', name: 'Costa Rica', capital: 'San José' },
  { id: 'HRV', name: 'Croatia', capital: 'Zagreb' },
  { id: 'CUB', name: 'Cuba', capital: 'Havana' },
  { id: 'CYP', name: 'Cyprus', capital: 'Nicosia' },
  { id: 'CZE', name: 'Czech Republic', capital: 'Prague' },
  { id: 'DNK', name: 'Denmark', capital: 'Copenhagen' },
  { id: 'DJI', name: 'Djibouti', capital: 'Djibouti' },
  { id: 'DOM', name: 'Dominican Republic', capital: 'Santo Domingo' },
  { id: 'ECU', name: 'Ecuador', capital: 'Quito' },
  { id: 'EGY', name: 'Egypt', capital: 'Cairo' },
  { id: 'SLV', name: 'El Salvador', capital: 'San Salvador' },
  { id: 'GNQ', name: 'Equatorial Guinea', capital: 'Malabo' },
  { id: 'ERI', name: 'Eritrea', capital: 'Asmara' },
  { id: 'EST', name: 'Estonia', capital: 'Tallinn' },
  { id: 'SWZ', name: 'Eswatini', capital: 'Mbabane' },
  { id: 'ETH', name: 'Ethiopia', capital: 'Addis Ababa' },
  { id: 'FJI', name: 'Fiji', capital: 'Suva' },
  { id: 'FIN', name: 'Finland', capital: 'Helsinki' },
  { id: 'FRA', name: 'France', capital: 'Paris' },
  { id: 'GAB', name: 'Gabon', capital: 'Libreville' },
  { id: 'GMB', name: 'Gambia', capital: 'Banjul' },
  { id: 'GEO', name: 'Georgia', capital: 'Tbilisi' },
  { id: 'DEU', name: 'Germany', capital: 'Berlin' },
  { id: 'GHA', name: 'Ghana', capital: 'Accra' },
  { id: 'GRC', name: 'Greece', capital: 'Athens' },
  { id: 'GTM', name: 'Guatemala', capital: 'Guatemala City' },
  { id: 'GIN', name: 'Guinea', capital: 'Conakry' },
  { id: 'GNB', name: 'Guinea-Bissau', capital: 'Bissau' },
  { id: 'GUY', name: 'Guyana', capital: 'Georgetown' },
  { id: 'HTI', name: 'Haiti', capital: 'Port-au-Prince' },
  { id: 'HND', name: 'Honduras', capital: 'Tegucigalpa' },
  { id: 'HUN', name: 'Hungary', capital: 'Budapest' },
  { id: 'ISL', name: 'Iceland', capital: 'Reykjavík' },
  { id: 'IND', name: 'India', capital: 'New Delhi' },
  { id: 'IDN', name: 'Indonesia', capital: 'Jakarta' },
  { id: 'IRN', name: 'Iran', capital: 'Tehran' },
  { id: 'IRQ', name: 'Iraq', capital: 'Baghdad' },
  { id: 'IRL', name: 'Ireland', capital: 'Dublin' },
  { id: 'ISR', name: 'Israel', capital: 'Jerusalem' },
  { id: 'ITA', name: 'Italy', capital: 'Rome' },
  { id: 'JAM', name: 'Jamaica', capital: 'Kingston' },
  { id: 'JPN', name: 'Japan', capital: 'Tokyo' },
  { id: 'JOR', name: 'Jordan', capital: 'Amman' },
  { id: 'KAZ', name: 'Kazakhstan', capital: 'Astana' },
  { id: 'KEN', name: 'Kenya', capital: 'Nairobi' },
  { id: 'KIR', name: 'Kiribati', capital: 'South Tarawa' },
  { id: 'PRK', name: 'North Korea', capital: 'Pyongyang' },
  { id: 'KOR', name: 'South Korea', capital: 'Seoul' },
  { id: 'XKX', name: 'Kosovo', capital: 'Pristina' },
  { id: 'KWT', name: 'Kuwait', capital: 'Kuwait City' },
  { id: 'KGZ', name: 'Kyrgyzstan', capital: 'Bishkek' },
  { id: 'LAO', name: 'Laos', capital: 'Vientiane' },
  { id: 'LVA', name: 'Latvia', capital: 'Riga' },
  { id: 'LBN', name: 'Lebanon', capital: 'Beirut' },
  { id: 'LSO', name: 'Lesotho', capital: 'Maseru' },
  { id: 'LBR', name: 'Liberia', capital: 'Monrovia' },
  { id: 'LBY', name: 'Libya', capital: 'Tripoli' },
  { id: 'LIE', name: 'Liechtenstein', capital: 'Vaduz' },
  { id: 'LTU', name: 'Lithuania', capital: 'Vilnius' },
  { id: 'LUX', name: 'Luxembourg', capital: 'Luxembourg City' },
  { id: 'MDG', name: 'Madagascar', capital: 'Antananarivo' },
  { id: 'MWI', name: 'Malawi', capital: 'Lilongwe' },
  { id: 'MYS', name: 'Malaysia', capital: 'Kuala Lumpur' },
  { id: 'MDV', name: 'Maldives', capital: 'Malé' },
  { id: 'MLI', name: 'Mali', capital: 'Bamako' },
  { id: 'MLT', name: 'Malta', capital: 'Valletta' },
  { id: 'MHL', name: 'Marshall Islands', capital: 'Majuro' },
  { id: 'MRT', name: 'Mauritania', capital: 'Nouakchott' },
  { id: 'MUS', name: 'Mauritius', capital: 'Port Louis' },
  { id: 'MEX', name: 'Mexico', capital: 'Mexico City' },
  { id: 'FSM', name: 'Micronesia', capital: 'Palikir' },
  { id: 'MDA', name: 'Moldova', capital: 'Chișinău' },
  { id: 'MCO', name: 'Monaco', capital: 'Monaco' },
  { id: 'MNG', name: 'Mongolia', capital: 'Ulaanbaatar' },
  { id: 'MNE', name: 'Montenegro', capital: 'Podgorica' },
  { id: 'MAR', name: 'Morocco', capital: 'Rabat' },
  { id: 'MOZ', name: 'Mozambique', capital: 'Maputo' },
  { id: 'MMR', name: 'Myanmar', capital: 'Naypyidaw' },
  { id: 'NAM', name: 'Namibia', capital: 'Windhoek' },
  { id: 'NRU', name: 'Nauru', capital: 'Yaren' },
  { id: 'NPL', name: 'Nepal', capital: 'Kathmandu' },
  { id: 'NLD', name: 'Netherlands', capital: 'Amsterdam' },
  { id: 'NZL', name: 'New Zealand', capital: 'Wellington' },
  { id: 'NIC', name: 'Nicaragua', capital: 'Managua' },
  { id: 'NER', name: 'Niger', capital: 'Niamey' },
  { id: 'NGA', name: 'Nigeria', capital: 'Abuja' },
  { id: 'MKD', name: 'North Macedonia', capital: 'Skopje' },
  { id: 'NOR', name: 'Norway', capital: 'Oslo' },
  { id: 'OMN', name: 'Oman', capital: 'Muscat' },
  { id: 'PAK', name: 'Pakistan', capital: 'Islamabad' },
  { id: 'PLW', name: 'Palau', capital: 'Ngerulmud' },
  { id: 'PAN', name: 'Panama', capital: 'Panama City' },
  { id: 'PNG', name: 'Papua New Guinea', capital: 'Port Moresby' },
  { id: 'PRY', name: 'Paraguay', capital: 'Asunción' },
  { id: 'PER', name: 'Peru', capital: 'Lima' },
  { id: 'PHL', name: 'Philippines', capital: 'Manila' },
  { id: 'POL', name: 'Poland', capital: 'Warsaw' },
  { id: 'PRT', name: 'Portugal', capital: 'Lisbon' },
  { id: 'QAT', name: 'Qatar', capital: 'Doha' },
  { id: 'ROU', name: 'Romania', capital: 'Bucharest' },
  { id: 'RUS', name: 'Russia', capital: 'Moscow' },
  { id: 'RWA', name: 'Rwanda', capital: 'Kigali' },
  { id: 'KNA', name: 'Saint Kitts and Nevis', capital: 'Basseterre' },
  { id: 'LCA', name: 'Saint Lucia', capital: 'Castries' },
  { id: 'VCT', name: 'Saint Vincent and the Grenadines', capital: 'Kingstown' },
  { id: 'WSM', name: 'Samoa', capital: 'Apia' },
  { id: 'SMR', name: 'San Marino', capital: 'San Marino' },
  { id: 'STP', name: 'São Tomé and Príncipe', capital: 'São Tomé' },
  { id: 'SAU', name: 'Saudi Arabia', capital: 'Riyadh' },
  { id: 'SEN', name: 'Senegal', capital: 'Dakar' },
  { id: 'SRB', name: 'Serbia', capital: 'Belgrade' },
  { id: 'SYC', name: 'Seychelles', capital: 'Victoria' },
  { id: 'SLE', name: 'Sierra Leone', capital: 'Freetown' },
  { id: 'SGP', name: 'Singapore', capital: 'Singapore' },
  { id: 'SVK', name: 'Slovakia', capital: 'Bratislava' },
  { id: 'SVN', name: 'Slovenia', capital: 'Ljubljana' },
  { id: 'SLB', name: 'Solomon Islands', capital: 'Honiara' },
  { id: 'SOM', name: 'Somalia', capital: 'Mogadishu' },
  { id: 'ZAF', name: 'South Africa', capital: 'Pretoria' },
  { id: 'SSD', name: 'South Sudan', capital: 'Juba' },
  { id: 'ESP', name: 'Spain', capital: 'Madrid' },
  { id: 'LKA', name: 'Sri Lanka', capital: 'Sri Jayawardenepura Kotte' },
  { id: 'SDN', name: 'Sudan', capital: 'Khartoum' },
  { id: 'SUR', name: 'Suriname', capital: 'Paramaribo' },
  { id: 'SWE', name: 'Sweden', capital: 'Stockholm' },
  { id: 'CHE', name: 'Switzerland', capital: 'Bern' },
  { id: 'SYR', name: 'Syria', capital: 'Damascus' },
  { id: 'TWN', name: 'Taiwan', capital: 'Taipei' },
  { id: 'TJK', name: 'Tajikistan', capital: 'Dushanbe' },
  { id: 'TZA', name: 'Tanzania', capital: 'Dodoma' },
  { id: 'THA', name: 'Thailand', capital: 'Bangkok' },
  { id: 'TLS', name: 'Timor-Leste', capital: 'Dili' },
  { id: 'TGO', name: 'Togo', capital: 'Lomé' },
  { id: 'TON', name: 'Tonga', capital: 'Nukuʻalofa' },
  { id: 'TTO', name: 'Trinidad and Tobago', capital: 'Port of Spain' },
  { id: 'TUN', name: 'Tunisia', capital: 'Tunis' },
  { id: 'TUR', name: 'Turkey', capital: 'Ankara' },
  { id: 'TKM', name: 'Turkmenistan', capital: 'Ashgabat' },
  { id: 'TUV', name: 'Tuvalu', capital: 'Funafuti' },
  { id: 'UGA', name: 'Uganda', capital: 'Kampala' },
  { id: 'UKR', name: 'Ukraine', capital: 'Kyiv' },
  { id: 'ARE', name: 'United Arab Emirates', capital: 'Abu Dhabi' },
  { id: 'GBR', name: 'United Kingdom', capital: 'London' },
  { id: 'USA', name: 'United States', capital: 'Washington, D.C.' },
  { id: 'URY', name: 'Uruguay', capital: 'Montevideo' },
  { id: 'UZB', name: 'Uzbekistan', capital: 'Tashkent' },
  { id: 'VUT', name: 'Vanuatu', capital: 'Port Vila' },
  { id: 'VAT', name: 'Vatican City', capital: 'Vatican City' },
  { id: 'VEN', name: 'Venezuela', capital: 'Caracas' },
  { id: 'VNM', name: 'Vietnam', capital: 'Hanoi' },
  { id: 'YEM', name: 'Yemen', capital: 'Sanaa' },
  { id: 'ZMB', name: 'Zambia', capital: 'Lusaka' },
  { id: 'ZWE', name: 'Zimbabwe', capital: 'Harare' },
]

const COUNTRY_MAP = Object.fromEntries(COUNTRIES.map(c => [c.id, c]))

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 480, margin: '0 auto' },
  card: { background: '#0a0f2e', borderRadius: 12, padding: '14px 16px', border: '1px solid #1a2460' },
  title: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#f5c518', letterSpacing: 3, marginBottom: 4 },
  subtitle: { fontSize: 11, color: '#4060a0', letterSpacing: 2 },
  prompt: { fontSize: 16, color: '#c0c8e8', lineHeight: 1.5, margin: '12px 0' },
  input: { width: '100%', background: '#060b1a', border: '1px solid #1a2460', borderRadius: 8, padding: '10px 12px', color: '#e8e8f0', fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' },
  btn: { background: 'linear-gradient(135deg, #1a3a8f, #0d1e5c)', border: '1px solid #2a4080', borderRadius: 10, padding: '12px 0', width: '100%', color: '#f5c518', fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2, cursor: 'pointer' },
  btnSecondary: { background: '#060b1a', border: '1px solid #1a2460', borderRadius: 10, padding: '10px 0', width: '100%', color: '#6070a0', fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: 2, cursor: 'pointer' },
  correct: { color: '#4caf7d', fontSize: 13, fontWeight: 700 },
  incorrect: { color: '#e57373', fontSize: 13 },
  progress: { fontSize: 11, color: '#4060a0', letterSpacing: 2, textAlign: 'center' },
  scoreBox: { textAlign: 'center', padding: '20px 0' },
  bigNum: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: '#f5c518' },
}

// ─── Presidents Drill ─────────────────────────────────────────────────────────
export function PresidentsDrill({ onBack, cards = [], setCards = () => {} }) {
  const [mode, setMode] = useState('setup') // setup | quiz | results
  const [missCounts, setMissCounts] = useState(() => getDrillMissCounts('presidents'))
  const [order, setOrder] = useState('sequential')
  const [prompt, setPrompt] = useState('number') // number → name, or name → number
  const [queue, setQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const [results, setResults] = useState([]) // { president, userAnswer, correct }
  const [revealed, setRevealed] = useState(false)
  const inputRef = useRef(null)

  function startQuiz() {
    const q = order === 'sequential' ? [...PRESIDENTS] : [...PRESIDENTS].sort(() => Math.random() - 0.5)
    setQueue(q)
    setIdx(0)
    setResults([])
    setAnswer('')
    setRevealed(false)
    setMode('quiz')
  }

  function checkAnswer(override = false) {
    const pres = queue[idx]
    const userAns = override ? '(marked correct)' : answer.trim()
    let correct = override

    if (!override) {
      if (prompt === 'number') {
        correct = fuzzyMatch(userAns, pres.name)
      } else {
        correct = userAns.trim() === String(pres.num)
      }
    }

    setResults(prev => [...prev, { president: pres, userAnswer: userAns, correct }])
    setRevealed(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function markCorrect() {
    // Override last result as correct
    setResults(prev => {
      const updated = [...prev]
      updated[updated.length - 1] = { ...updated[updated.length - 1], correct: true }
      return updated
    })
  }

  function next() {
    if (idx + 1 >= queue.length) {
      const finalResults = [...results, { correct: results.length < queue.length }]
      saveDrillSession('presidents', results.filter(r => r.correct).length, queue.length)
      saveDrillMisses('presidents', results.filter(r => !r.correct).map(r => String(r.president.num)))
      setMissCounts(getDrillMissCounts('presidents'))
      setMode('results')
    } else {
      setIdx(i => i + 1)
      setAnswer('')
      setRevealed(false)
    }
  }

  const pres = queue[idx]
  const score = results.filter(r => r.correct).length

  if (mode === 'reference') return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.title}>US PRESIDENTS</div>
        <div style={S.subtitle}>REFERENCE LIST</div>
      </div>
      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        {PRESIDENTS.map((p, i) => (
          <div key={p.num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < PRESIDENTS.length - 1 ? '1px solid #0d1235' : 'none', background: i % 2 === 0 ? 'transparent' : '#060b1a' }}>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: '#f5c518', minWidth: 28, textAlign: 'right' }}>{p.num}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 13, color: missCounts[String(p.num)] > 0 ? '#ffb3b3' : '#c0c8e8' }}>{p.name}</div>
                {missCounts[String(p.num)] > 0 && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < missCounts[String(p.num)] ? '#e57373' : '#1a2460' }} />)}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#4060a0' }}>{p.years} · {p.party}</div>
            </div>
          </div>
        ))}
      </div>
      <button style={S.btnSecondary} onClick={() => setMode('setup')}>← Back</button>
    </div>
  )

  if (mode === 'setup') return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.title}>US PRESIDENTS</div>
        <div style={S.subtitle}>ALL 47 · NAME THE PRESIDENT</div>
      </div>
      <div style={S.card}>
        <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 2, marginBottom: 8 }}>MODE</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[['quiz', 'Quiz'], ['reference', 'Reference']].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v === 'reference' ? 'reference' : 'setup')} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${v === 'reference' ? '#4dd0e1' : '#f5c518'}`, background: v === 'reference' ? 'rgba(77,208,225,0.08)' : 'rgba(245,197,24,0.1)', color: v === 'reference' ? '#4dd0e1' : '#f5c518', cursor: 'pointer', fontSize: 13 }}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 2, marginBottom: 8 }}>ORDER</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[['sequential', 'In Order'], ['random', 'Random']].map(([v, l]) => (
            <button key={v} onClick={() => setOrder(v)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${order === v ? '#f5c518' : '#1a2460'}`, background: order === v ? 'rgba(245,197,24,0.1)' : '#060b1a', color: order === v ? '#f5c518' : '#6070a0', cursor: 'pointer', fontSize: 13 }}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 2, marginBottom: 8 }}>GIVEN → TYPE</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[['number', '#/Years → Name'], ['name', 'Name/Years → #']].map(([v, l]) => (
            <button key={v} onClick={() => setPrompt(v)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${prompt === v ? '#f5c518' : '#1a2460'}`, background: prompt === v ? 'rgba(245,197,24,0.1)' : '#060b1a', color: prompt === v ? '#f5c518' : '#6070a0', cursor: 'pointer', fontSize: 12 }}>{l}</button>
          ))}
        </div>
        <button style={S.btn} onClick={startQuiz}>START QUIZ</button>
      </div>
      <button style={S.btnSecondary} onClick={onBack}>← Back</button>
    </div>
  )

  if (mode === 'results') return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.title}>RESULTS</div>
        <div style={S.scoreBox}>
          <div style={S.bigNum}>{score}/{PRESIDENTS.length}</div>
          <div style={{ fontSize: 13, color: score >= 40 ? '#4caf7d' : score >= 30 ? '#f5c518' : '#e57373' }}>
            {score >= 44 ? 'Excellent!' : score >= 35 ? 'Good work' : score >= 20 ? 'Keep practicing' : 'Needs work'}
          </div>
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {results.filter(r => !r.correct).map((r, i) => (
            <div key={i} style={{ borderBottom: '1px solid #1a2040', padding: '6px 0', fontSize: 12 }}>
              <span style={{ color: '#4060a0' }}>#{r.president.num} {r.president.years}</span>
              <span style={{ color: '#e57373', marginLeft: 8 }}>✗ {r.userAnswer || '(blank)'}</span>
              <span style={{ color: '#4caf7d', marginLeft: 8 }}>→ {r.president.name}</span>
            </div>
          ))}
        </div>
      </div>
      {results.some(r => !r.correct) && (
        <button style={{ ...S.btnSecondary, color: '#4caf7d', borderColor: '#2e8c50' }} onClick={() => {
          const missed = results.filter(r => !r.correct).map(r => makeFlashCard(
            `#${r.president.num} · ${r.president.years} · ${r.president.party}`,
            `#${r.president.num} ${r.president.name} (${r.president.years})`,
            'US Presidents'
          ))
          const freshCards = loadCards()
          const existing = new Set(freshCards.map(c => c.front))
          const newCards = missed.filter(c => !existing.has(c.front))
          if (newCards.length) {
            const updated = [...freshCards, ...newCards]
            saveCards(updated); setCards(updated)
            alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck${missed.length - newCards.length > 0 ? ` (${missed.length - newCards.length} already existed)` : ''}`)
          } else { alert('All missed items already in your deck') }
        }}>+ Add missed to deck ({results.filter(r => !r.correct).length})</button>
      )}
      <button style={S.btn} onClick={() => { setMode('setup') }}>Try Again</button>
      <button style={S.btnSecondary} onClick={onBack}>← Back</button>
    </div>
  )

  return (
    <div style={S.wrap}>
      <div style={S.progress}>{idx + 1} / {queue.length} · {score} correct</div>
      <div style={S.card}>
        {prompt === 'number' ? (
          <>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: '#f5c518' }}>#{pres.num}</div>
            <div style={{ fontSize: 13, color: '#6070a0', marginBottom: 8 }}>{pres.years}</div>
            <div style={S.subtitle}>NAME THIS PRESIDENT</div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: '#c0c8e8' }}>{pres.name}</div>
            <div style={{ fontSize: 13, color: '#6070a0', marginBottom: 8 }}>{pres.years}</div>
            <div style={S.subtitle}>WHAT NUMBER PRESIDENT?</div>
          </>
        )}
        <input
          ref={inputRef}
          autoFocus
          style={{ ...S.input, marginTop: 12, borderColor: revealed ? (results[results.length-1]?.correct ? '#4caf7d' : '#e57373') : '#1a2460' }}
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') revealed ? next() : checkAnswer() }}
          placeholder={prompt === 'number' ? 'Type president name...' : 'Type number...'}
          readOnly={revealed}
        />
        {revealed && (
          <div style={{ marginTop: 8 }}>
            {results[results.length-1]?.correct
              ? <span style={S.correct}>✓ Correct!</span>
              : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={S.incorrect}>✗ {pres.name}</span>
                  <button
                    style={{ fontSize: 10, color: '#4caf7d', border: '1px solid #2e8c50', borderRadius: 6, padding: '2px 8px', background: '#0a1e10', cursor: 'pointer' }}
                    onClick={markCorrect}
                  >Mark correct</button>
                </div>
              )}
          </div>
        )}
      </div>
      {!revealed
        ? <button style={S.btn} onClick={() => checkAnswer()}>CHECK</button>
        : <button style={S.btn} onClick={next}>{idx + 1 >= queue.length ? 'SEE RESULTS' : 'NEXT →'}</button>}
      <button style={{ ...S.btnSecondary, fontSize:10, padding:'4px 0', color:'#4caf7d', borderColor:'#2e8c50' }} onClick={() => {
        const pres = queue[idx]
        const front = `#${pres.num} · ${pres.years} · ${pres.party}`
        const back = `#${pres.num} ${pres.name} (${pres.years})`
        const freshCards = loadCards()
        if (freshCards.some(c => c.front === front)) { alert('Already in deck'); return }
        const card = makeFlashCard(front, back, 'US Presidents')
        const updated = [...freshCards, card]
        saveCards(updated); setCards(updated)
        alert(`Added ${pres.name} to deck`)
      }}>＋ Add this card to deck</button>
    </div>
  )
}

// ─── Labeled Map Reference ───────────────────────────────────────────────────
function LabeledMapReference({ onBack, paths, pathCentroids }) {
  const [refMode, setRefMode] = useState('map') // map | list
  const [revealed, setRevealed] = useState(new Set())
  const [zoom, setZoom] = useState(1)
  const [minZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const [listSearch, setListSearch] = useState('')

  function toggleReveal(id) {
    setRevealed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filteredCountries = COUNTRIES
    .filter(c => !listSearch || c.name.toLowerCase().includes(listSearch.toLowerCase()) || c.capital.toLowerCase().includes(listSearch.toLowerCase()))
    .sort((a,b) => a.name.localeCompare(b.name))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
        <button style={{ fontSize: 12, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer' }} onClick={onBack}>← Back</button>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['map', '🗺 Map'], ['list', '📋 List']].map(([v, l]) => (
            <button key={v} onClick={() => setRefMode(v)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${refMode === v ? '#f5c518' : '#1a2460'}`, background: refMode === v ? 'rgba(245,197,24,0.1)' : '#060b1a', color: refMode === v ? '#f5c518' : '#6070a0', cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#2a3460' }}>tap to reveal capital</div>
      </div>

      {refMode === 'map' && (
        <>
          {/* Zoom controls */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => { const nz = Math.min(zoom * 1.5, 8); const cx = (480 - pan.x) / zoom; const cy = (250 - pan.y) / zoom; setPan({ x: 480 - cx * nz, y: 250 - cy * nz }); setZoom(nz) }}>+</button>
            <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18, opacity: zoom <= minZoom ? 0.3 : 1 }} disabled={zoom <= minZoom} onClick={() => { const nz = Math.max(zoom / 1.5, 1); setZoom(nz); if (nz <= minZoom) { setZoom(minZoom); setPan({ x: 0, y: 0 }) } }}>−</button>
            <button style={{ ...S.btnSecondary, flex: 1, padding: '6px 0', fontSize: 12 }} onClick={() => { setZoom(minZoom); setPan({ x: 0, y: 0 }) }}>Reset View</button>
            <button style={{ ...S.btnSecondary, flex: 1, padding: '6px 0', fontSize: 11, color: '#4dd0e1' }} onClick={() => setRevealed(new Set(COUNTRIES.map(c => c.id)))}>Show All</button>
            <button style={{ ...S.btnSecondary, flex: 1, padding: '6px 0', fontSize: 11 }} onClick={() => setRevealed(new Set())}>Hide All</button>
          </div>

          {/* Labeled map */}
          <div
            style={{ width: '100%', background: '#060b1a', borderRadius: 12, overflow: 'hidden', border: '1px solid #1a2460', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
            onMouseDown={e => { setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }) }}
            onMouseMove={e => { if (dragging && dragStart) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }) }}
            onMouseUp={() => setDragging(false)}
            onMouseLeave={() => setDragging(false)}
            onTouchStart={e => { const t = e.touches[0]; setDragging(true); setDragStart({ x: t.clientX - pan.x, y: t.clientY - pan.y }) }}
            onTouchMove={e => { if (dragging && dragStart) { const t = e.touches[0]; setPan({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y }) } }}
            onTouchEnd={() => setDragging(false)}
          >
            <svg viewBox="0 0 960 500" style={{ width: '100%', height: 'auto', display: 'block' }}>
              <rect width="960" height="500" fill="#060b1a" />
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                {/* Country shapes */}
                {paths.map(p => {
                  const country = COUNTRY_MAP[p.id]
                  const isRevealed = revealed.has(p.id)
                  return (
                    <path
                      key={p.id}
                      d={p.d}
                      fill={isRevealed ? '#4dd0e1' : (country ? '#1a3070' : '#0d1a3a')}
                      stroke="#0a0f2e"
                      strokeWidth={0.5 / zoom}
                      onClick={e => { if (!dragging && country) { e.stopPropagation(); toggleReveal(p.id) } }}
                      style={{ cursor: country ? 'pointer' : 'default', transition: 'fill 0.2s' }}
                    />
                  )
                })}
                {/* Country name labels */}
                {paths.map(p => {
                  const country = COUNTRY_MAP[p.id]
                  const centroid = pathCentroids.current[p.id]
                  if (!country || !centroid) return null
                  const isRevealed = revealed.has(p.id)
                  if (!isRevealed && zoom < 1.5) return null // hide unselected labels when zoomed out
                  return (
                    <g key={`label-${p.id}`} onClick={e => { if (!dragging) { e.stopPropagation(); toggleReveal(p.id) } }} style={{ cursor: 'pointer' }}>
                      <text
                        x={centroid.x}
                        y={centroid.y - (isRevealed ? 5 : 0)}
                        textAnchor="middle"
                        fontSize={10 / zoom}
                        fill={isRevealed ? '#fff' : '#8890d0'}
                        style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}
                      >
                        {country.name}
                      </text>
                      {isRevealed && (
                        <text
                          x={centroid.x}
                          y={centroid.y + 8 / zoom}
                          textAnchor="middle"
                          fontSize={8 / zoom}
                          fill="#f5c518"
                          style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}
                        >
                          {country.capital}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        </>
      )}

      {refMode === 'list' && (
        <>
          <input
            style={{ ...S.input }}
            value={listSearch}
            onChange={e => setListSearch(e.target.value)}
            placeholder="Search countries or capitals..."
          />
          <div style={{ ...S.card, padding: 0, overflow: 'hidden', maxHeight: 500, overflowY: 'auto' }}>
            {filteredCountries.map((c, i) => (
              <div
                key={c.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < filteredCountries.length - 1 ? '1px solid #0d1235' : 'none', background: revealed.has(c.id) ? 'rgba(77,208,225,0.06)' : i % 2 === 0 ? 'transparent' : '#060b1a', cursor: 'pointer' }}
                onClick={() => toggleReveal(c.id)}
              >
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: missCounts[c.id] > 0 ? '#ffb3b3' : '#c0c8e8' }}>{c.name}</span>
                  {missCounts[c.id] > 0 && <span style={{ display:'inline-flex', gap:2, marginLeft:4, verticalAlign:'middle' }}>{[0,1,2].map(i=><span key={i} style={{ width:6, height:6, borderRadius:'50%', background: i<missCounts[c.id]?'#e57373':'#1a2460', display:'inline-block' }}/>)}</span>}
                  {revealed.has(c.id) && (
                    <span style={{ fontSize: 12, color: '#f5c518', marginLeft: 10 }}>→ {c.capital}</span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: '#2a3460' }}>{revealed.has(c.id) ? '▲' : '▼'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── World Map Drill ──────────────────────────────────────────────────────────
export function WorldMapDrill({ onBack, preloadedPaths, preloadedCentroids, cards = [], setCards = () => {} }) {
  const [geoData, setGeoData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [answer, setAnswer] = useState({ country: '', capital: '' })
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [attempted, setAttempted] = useState(new Set())
  const [attemptResults, setAttemptResults] = useState({}) // id → { correct, country }
  const [missCounts, setMissCounts] = useState(() => getDrillMissCounts('world-map'))
  const [autoNext, setAutoNext] = useState(false)
  const sessionSaved = useRef(false)
  const [mode, setMode] = useState('map')
  const [showReference, setShowReference] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const inputRef = useRef(null)
  const svgRef = useRef(null)
  const [paths, setPaths] = useState([])
  const [zoom, setZoom] = useState(1)
  const [minZoom, setMinZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const pathCentroids = useRef({}) // id → {x, y} center

  useEffect(() => {
    if (preloadedPaths?.length > 0) {
      setPaths(preloadedPaths)
      if (preloadedCentroids) pathCentroids.current = preloadedCentroids.current
      setGeoData(true) // mark as loaded
      setLoading(false)
      return
    }
    // Fetch directly if hub hasn't pre-fetched yet
    fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then(data => {
        setGeoData(data)
        buildPaths(data)
        setLoading(false)
      })
      .catch(err => { console.error('World map fetch failed:', err); setLoading(false) })
  }, [preloadedPaths, retryCount])

  function buildPaths(data) {
    const w = 960, h = 500
    const project = ([lon, lat]) => [
      (lon + 180) * (w / 360),
      (90 - lat) * (h / 180)
    ]

    function coordsToPath(coords) {
      return coords.map(ring =>
        ring.map((pt, pi) => {
          const [x, y] = project(pt)
          return `${pi === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        }).join(' ') + ' Z'
      ).join(' ')
    }

    function getCentroid(coords) {
      // Use bounding box center (more accurate than vertex average for irregular shapes)
      const ring = coords[0]
      const pts = ring.map(p => project(p))
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      }
    }

    const centroids = {}
    const built = data.features.map(f => {
      const id = f.id || f.properties?.iso_a3
      let d = '', centroid = null
      if (f.geometry?.type === 'Polygon') {
        d = coordsToPath(f.geometry.coordinates)
        centroid = getCentroid(f.geometry.coordinates)
      } else if (f.geometry?.type === 'MultiPolygon') {
        d = f.geometry.coordinates.map(poly => coordsToPath(poly)).join(' ')
        // Use largest polygon for centroid
        const largest = f.geometry.coordinates.reduce((a,b) => b[0].length > a[0].length ? b : a)
        centroid = getCentroid(largest)
      }
      if (centroid) centroids[id] = centroid
      return { id, name: f.properties?.name, d }
    }).filter(p => p.d)

    pathCentroids.current = centroids
    setPaths(built)
  }

  // Auto-select next country generally moving east
  function autoSelectNext() {
    const unattempted = COUNTRIES.filter(c => !attempted.has(c.id))
    if (unattempted.length === 0) return

    // Sort by longitude (west to east), then latitude (north to south)
    const withCentroids = unattempted
      .map(c => ({ ...c, centroid: pathCentroids.current[c.id] }))
      .filter(c => c.centroid)

    if (withCentroids.length === 0) {
      // Fallback: pick random
      const r = unattempted[Math.floor(Math.random() * unattempted.length)]
      handleCountryClick(r.id)
      return
    }

    // Find current position (selected country centroid or start from left)
    const curCentroid = selected && pathCentroids.current[selected]
      ? pathCentroids.current[selected]
      : { x: 0, y: 0 }

    // Find nearest country to the east (higher x), wrapping around
    let eastward = withCentroids.filter(c => c.centroid.x > curCentroid.x + 10)
    if (eastward.length === 0) eastward = withCentroids // wrap to start

    // Sort by x then y, pick closest
    eastward.sort((a, b) => a.centroid.x - b.centroid.x || a.centroid.y - b.centroid.y)
    handleCountryClick(eastward[0].id)

    // Pan/zoom to selected country
    const c = eastward[0].centroid
    setPan({ x: -(c.x * zoom - 480), y: -(c.y * zoom - 250) })
  }

  function handleCountryClick(id) {
    if (attempted.has(id)) return
    setSelected(id)
    setAnswer({ country: '', capital: '' })
    setResult(null)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function checkAnswer(overrideCountry = false, overrideCapital = false) {
    const country = COUNTRY_MAP[selected]
    if (!country) return
    const countryCorrect = overrideCountry || fuzzyMatch(answer.country, country.name)
    const capitalCorrect = overrideCapital || fuzzyMatch(answer.capital, country.capital)
    const bothCorrect = countryCorrect && capitalCorrect
    setResult({ countryCorrect, capitalCorrect, country })
    setAttempted(prev => new Set([...prev, selected]))
    const newResults = { ...attemptResults, [selected]: { correct: bothCorrect, countryCorrect, capitalCorrect, country } }
    setAttemptResults(newResults)
    const newScore = { correct: score.correct + (bothCorrect ? 1 : 0), total: score.total + 1 }
    setScore(newScore)
    if (totalKnown - attempted.size - 1 === 0 && !sessionSaved.current) {
      sessionSaved.current = true
      saveDrillSession('world-map', newScore.correct, newScore.total)
      saveDrillMisses('world-map', Object.entries(newResults).filter(([,r]) => !r.correct).map(([id]) => id))
      setMissCounts(getDrillMissCounts('world-map'))
    }
    if (autoNext) setTimeout(() => { setSelected(null); setResult(null); autoSelectNext() }, 1200)
  }

  function markItemCorrect(field) {
    if (!result) return
    const updated = { ...result, [field + 'Correct']: true }
    setResult(updated)
    const nowBoth = updated.countryCorrect && updated.capitalCorrect
    setAttemptResults(prev => ({ ...prev, [selected]: { ...prev[selected], [field + 'Correct']: true, correct: nowBoth } }))
    if (nowBoth) setScore(prev => ({ ...prev, correct: prev.correct + 1 }))
  }

  function getColor(id) {
    if (id === selected) return '#f5c518'
    if (attempted.has(id)) return '#e0e0e0'
    return '#1a3070'
  }

  const totalKnown = COUNTRIES.length
  const remaining = totalKnown - attempted.size

  if (showReference) return (
    <LabeledMapReference onBack={() => setShowReference(false)} paths={paths} pathCentroids={pathCentroids} />
  )

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:300, gap:12 }}>
      <div style={{ color: '#4060a0', fontSize: 13, letterSpacing:2 }}>LOADING WORLD MAP...</div>
      <div style={{ fontSize:10, color:'#2a3460' }}>Fetching GeoJSON data</div>
    </div>
  )

  if (!geoData || paths.length === 0) return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={{ color: '#e57373', fontSize: 13, marginBottom:8 }}>Failed to load map data.</div>
        <div style={{ fontSize:11, color:'#4060a0' }}>Check your connection and try again.</div>
      </div>
      <button style={S.btn} onClick={() => { setLoading(true); setGeoData(null); setPaths([]); setRetryCount(c => c+1) }}>Retry</button>
      <button style={S.btnSecondary} onClick={onBack}>← Back</button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      {/* Score bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
        <button style={{ fontSize: 12, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer' }} onClick={onBack}>← Back</button>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={{ fontSize: 11, color: '#4dd0e1', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowReference(true)}>📋 Reference</button>
          <div style={{ fontSize: 11, color: '#4060a0', letterSpacing: 2 }}>{score.correct}/{score.total} · {remaining} left</div>
          {remaining === 0 && Object.entries(attemptResults).some(([,r]) => !r.correct) && (
            <button style={{ fontSize: 10, color: '#4caf7d', border: '1px solid #2e8c50', borderRadius: 6, padding: '2px 8px', background: '#0a1e10', cursor: 'pointer' }} onClick={() => {
              const missed = Object.entries(attemptResults).filter(([,r]) => !r.correct).map(([id, r]) => {
                const p = paths.find(p => p.id === id)
                const img = p ? makeMapSnapshot(p, paths) : null
                const card = makeFlashCard(img ? `[Map] ${r.country.name}` : r.country.name, `${r.country.name} · Capital: ${r.country.capital}`, 'Geography · World Map')
                if (img) card.image = img
                return card
              })
              const freshCards = loadCards()
              const existing = new Set(freshCards.map(c => c.front))
              const newCards = missed.filter(c => !existing.has(c.front))
              if (newCards.length) {
                const updated = [...freshCards, ...newCards]
                try {
                  saveCards(updated)
                  setCards(updated)
                  alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck`)
                } catch {
                  const stripped = newCards.map(c => { const {image, ...rest} = c; return rest })
                  const updated2 = [...freshCards, ...stripped]
                  saveCards(updated2); setCards(updated2)
                  alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck (without map images - storage full)`)
                }
              } else { alert('No new cards to add') }
            }}>+ Add missed ({Object.entries(attemptResults).filter(([,r]) => !r.correct).length})</button>
          )}
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => { const nz = Math.min(zoom * 1.5, 8); const cx = (480 - pan.x) / zoom; const cy = (250 - pan.y) / zoom; setPan({ x: 480 - cx * nz, y: 250 - cy * nz }); setZoom(nz) }}>+</button>
        <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18, opacity: zoom <= minZoom ? 0.3 : 1 }} disabled={zoom <= minZoom} onClick={() => { const nz = Math.max(zoom / 1.5, 1); setZoom(nz); if (nz <= minZoom) { setZoom(minZoom); setPan({ x: 0, y: 0 }) } }}>−</button>
        <button style={{ ...S.btnSecondary, flex: 1, padding: '6px 0', fontSize: 12 }} onClick={() => { setZoom(minZoom); setPan({ x: 0, y: 0 }) }}>Reset View</button>
        <button style={{ ...S.btn, flex: 1, padding: '6px 0', fontSize: 12, background: autoNext ? 'rgba(245,197,24,0.15)' : undefined, border: autoNext ? '1px solid #f5c518' : undefined }} onClick={() => { setAutoNext(a => !a) }}>Auto Next {autoNext ? '✓' : '→'}</button>
      </div>

      {/* Map */}
      <div
        style={{ width: '100%', background: '#060b1a', borderRadius: 12, overflow: 'hidden', border: '1px solid #1a2460', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
        onMouseDown={e => { setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }) }}
        onMouseMove={e => { if (dragging && dragStart) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        onTouchStart={e => { const t = e.touches[0]; setDragging(true); setDragStart({ x: t.clientX - pan.x, y: t.clientY - pan.y }) }}
        onTouchMove={e => { if (dragging && dragStart) { const t = e.touches[0]; setPan({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y }) } }}
        onTouchEnd={() => setDragging(false)}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 960 500"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <rect width="960" height="500" fill="#060b1a" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`} style={{ transformOrigin: '480px 250px' }}>
            {paths.map(p => (
              <path
                key={p.id}
                d={p.d}
                fill={getColor(p.id)}
                stroke="#0a0f2e"
                strokeWidth={0.5 / zoom}
                onClick={e => { if (!dragging) { e.stopPropagation(); handleCountryClick(p.id) } }}
                style={{ cursor: COUNTRY_MAP[p.id] ? 'pointer' : 'default', transition: 'fill 0.15s' }}
              />
            ))}
          {/* Permanent labels for attempted countries */}
          {paths.map(p => {
            const res = attemptResults[p.id]
            const c = pathCentroids.current[p.id]
            if (!res || !c) return null
            return (
              <g key={`lbl-${p.id}`} style={{ pointerEvents: 'none' }}>
                <text x={c.x} y={c.y - 4/zoom} textAnchor="middle" fontSize={7/zoom} fill={res.countryCorrect ? '#4caf7d' : '#e53935'} fontWeight="bold" fontFamily="sans-serif">{res.country.name}</text>
                <text x={c.x} y={c.y + 5/zoom} textAnchor="middle" fontSize={6/zoom} fill={res.capitalCorrect ? '#4caf7d' : '#e53935'} fontFamily="sans-serif">{res.country.capital}</text>
              </g>
            )
          })}
          </g>
        </svg>
      </div>

      {/* Answer panel */}
      {selected && (
        <div style={S.card}>
          {result ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={result.countryCorrect ? S.correct : S.incorrect}>
                  {result.countryCorrect ? '✓' : '✗'} Country: {result.country.name}
                </span>
                {!result.countryCorrect && (
                  <button style={{ fontSize: 10, color: '#4caf7d', border: '1px solid #2e8c50', borderRadius: 6, padding: '2px 8px', background: '#0a1e10', cursor: 'pointer' }} onClick={() => markItemCorrect('country')}>Mark correct</button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={result.capitalCorrect ? S.correct : S.incorrect}>
                  {result.capitalCorrect ? '✓' : '✗'} Capital: {result.country.capital}
                </span>
                {!result.capitalCorrect && (
                  <button style={{ fontSize: 10, color: '#4caf7d', border: '1px solid #2e8c50', borderRadius: 6, padding: '2px 8px', background: '#0a1e10', cursor: 'pointer' }} onClick={() => markItemCorrect('capital')}>Mark correct</button>
                )}
              </div>
              <button style={{ ...S.btn, marginTop: 12, fontSize: 14 }} onClick={() => setSelected(null)}>
              <button style={{ fontSize:10, color:'#4dd0e1', border:'1px solid #1a4060', borderRadius:6, padding:'3px 10px', background:'#0a1e20', cursor:'pointer', marginTop:6 }} onClick={() => {
                const country = COUNTRY_MAP[selected]
                if (!country) return
                const freshCards = loadCards()
                const p = paths.find(p2 => p2.id === selected)
                const img = p ? makeMapSnapshot(p, paths) : null
                const front = img ? `[Map] ${country.name}` : country.name
                if (freshCards.some(c => c.front === front)) { alert('Already in deck'); return }
                const card = makeFlashCard(front, `${country.name} · Capital: ${country.capital}`, 'Geography · World Map')
                if (img) card.image = img
                const updated = [...freshCards, card]; saveCards(updated); setCards(updated)
                alert(`Added ${country.name} to deck`)
              }}>＋ Add to deck</button>
                TAP ANOTHER COUNTRY
              </button>
            </div>
          ) : (
            <div>
              <div style={S.subtitle}>TAP TO IDENTIFY</div>
              <input
                ref={inputRef}
                style={{ ...S.input, marginTop: 8, marginBottom: 8 }}
                value={answer.country}
                onChange={e => setAnswer(a => ({ ...a, country: e.target.value }))}
                placeholder="Country name..."
              />
              <input
                style={{ ...S.input, marginBottom: 10 }}
                value={answer.capital}
                onChange={e => setAnswer(a => ({ ...a, capital: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') checkAnswer() }}
                placeholder="Capital city..."
              />
              <button style={S.btn} onClick={() => checkAnswer()}>CHECK</button>
            </div>
          )}
        </div>
      )}

      {!selected && (
        <div style={{ textAlign: 'center', fontSize: 12, color: '#2a3460', padding: '8px 0' }}>
          Tap any country on the map
        </div>
      )}
    </div>
  )
}

// ─── Drills Hub ───────────────────────────────────────────────────────────────
export function DrillsView({ cards = [], setCards = () => {} }) {
  const [drill, setDrill] = useState(null)
  const [stats, setStats] = useState(loadDrillStats())
  // Share world map data across world/regional drills to avoid re-fetching
  const [worldPaths, setWorldPaths] = useState([])
  const [worldLoading, setWorldLoading] = useState(false)
  const worldCentroids = useRef({})

  const handleBack = () => { setDrill(null); setStats(loadDrillStats()) }

  // Pre-load world GeoJSON when hub mounts
  useEffect(() => {
    if (worldPaths.length > 0) return
    setWorldLoading(true)
    fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
      .then(r => r.json())
      .then(data => {
        const w = 960, h = 500
        const project = ([lon, lat]) => [(lon + 180) * (w / 360), (90 - lat) * (h / 180)]
        function toPath(coords) {
          return coords.map(ring => ring.map((pt, pi) => { const [x,y]=project(pt); return `${pi===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}` }).join(' ') + ' Z').join(' ')
        }
        function getCentroid(coords) {
          const pts = coords[0].map(p => project(p))
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
          return {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
          }
        }
        const centroids = {}
        const built = data.features.map(f => {
          const id = f.id || f.properties?.iso_a3
          let d='', centroid=null
          if (f.geometry?.type==='Polygon') { d=toPath(f.geometry.coordinates); centroid=getCentroid(f.geometry.coordinates) }
          else if (f.geometry?.type==='MultiPolygon') { d=f.geometry.coordinates.map(p=>toPath(p)).join(' '); const lg=f.geometry.coordinates.reduce((a,b)=>b[0].length>a[0].length?b:a); centroid=getCentroid(lg) }
          if (centroid) centroids[id]=centroid
          return { id, name: f.properties?.name, d }
        }).filter(p=>p.d)
        worldCentroids.current = centroids
        setWorldPaths(built)
        setWorldLoading(false)
      })
      .catch(() => setWorldLoading(false))
  }, [])

  if (drill === 'knowledge') return <KnowledgeHub onBack={handleBack} onSelect={setDrill} stats={stats} />
  if (drill === 'presidents') return <PresidentsDrill onBack={() => setDrill('knowledge')} cards={cards} setCards={setCards} />
  if (drill && FLASH_DRILLS[drill]) return <FlashDrill drillKey={drill} onBack={() => setDrill('knowledge')} cards={cards} setCards={setCards} />
  if (drill === 'geography') return (
    <GeographyHub
      onBack={handleBack}
      onSelect={setDrill}
      stats={stats}
      worldLoading={worldLoading}
    />
  )
  if (drill === 'worldmap') return <WorldMapDrill onBack={() => setDrill('geography')} preloadedPaths={worldPaths} preloadedCentroids={worldCentroids} />
  if (drill?.startsWith('region-')) return <RegionalMapDrill regionKey={drill.replace('region-','')} onBack={() => setDrill('geography')} worldPaths={worldPaths} worldCentroids={worldCentroids} />
  if (drill === 'us-states') return <SubnationalMapDrill onBack={() => setDrill('geography')} config={{ geojsonUrl:'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json', data:US_STATES, regionLabel:'State', bounds:[-125,-66,24,50], width:960, height:560 }} cards={cards} setCards={setCards} />
  if (drill === 'canada') return <SubnationalMapDrill onBack={() => setDrill('geography')} config={{ geojsonUrl:'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/canada.geojson', data:CANADA_PROVINCES, regionLabel:'Province', bounds:[-141,-52,41,84], width:960, height:640 }} cards={cards} setCards={setCards} />
  if (drill === 'mexico') return <SubnationalMapDrill onBack={() => setDrill('geography')} config={{ geojsonUrl:'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/mexico.geojson', data:MEXICO_STATES, regionLabel:'State', bounds:[-118,-86,14,33], width:960, height:500 }} cards={cards} setCards={setCards} />

  // Top-level hub
  return (
    <div style={{ ...S.wrap, paddingTop: 8 }}>
      <div style={{ background: 'linear-gradient(135deg, #0a0f2e 0%, #0f1e6e 100%)', borderRadius: 12, padding: '20px 16px', marginBottom: 4, textAlign: 'center', border: '1px solid #2a3480' }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: '#f5c518', letterSpacing: 4 }}>DRILLS</div>
        <div style={{ fontSize: 11, color: '#4060a0', letterSpacing: 2, marginTop: 2 }}>STANDALONE PRACTICE TESTS</div>
      </div>

      {[
        { id: 'geography', emoji: '🌍', label: 'GEOGRAPHY', desc: 'World & regional maps, states & capitals' },
        { id: 'knowledge', emoji: '🧠', label: 'KNOWLEDGE', desc: 'Presidents, arts, science, language & more' },
      ].map((d, i) => {
        if (d.isHeader) return <div key={i} style={{ fontSize: 9, color: '#2a3460', letterSpacing: 3, textAlign: 'center', padding: '4px 0' }}>{d.label}</div>
        const history = stats[d.id] || []
        const best = history.length > 0 ? Math.max(...history.map(s => s.pct)) : null
        return (
          <button key={d.id} style={{ ...S.card, textAlign: 'left', cursor: 'pointer', border: '1px solid #1a2460', width: '100%', padding: '18px 20px' }} onClick={() => setDrill(d.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#f5c518', letterSpacing: 2 }}>{d.emoji} {d.label}</div>
                <div style={{ fontSize: 11, color: '#4060a0', marginTop: 2 }}>{d.desc}</div>
              </div>
              {best !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: best >= 80 ? '#4caf7d' : best >= 60 ? '#f5c518' : '#e57373' }}>{best}%</div>
                  <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1 }}>BEST</div>
                </div>
              )}
            </div>
            {history.slice(0,3).map((s, j) => (
              <span key={j} style={{ fontSize: 9, color: s.pct >= 80 ? '#4caf7d' : s.pct >= 60 ? '#f5c518' : '#e57373', background: '#060b1a', borderRadius: 4, padding: '2px 6px', border: '1px solid #1a2040', marginRight: 4, display: 'inline-block', marginTop: 6 }}>
                {s.pct}% · {s.date}
              </span>
            ))}
          </button>
        )
      })}
    </div>
  )
}

// ─── Knowledge Hub ───────────────────────────────────────────────────────────
function KnowledgeHub({ onBack, onSelect, stats }) {
  const knowledgeDrills = [
    { id: 'presidents', emoji: '🇺🇸', label: 'US PRESIDENTS', desc: 'All 47 presidents · number, name & years' },
    { id: 'vice_presidents', emoji: '🏛', label: 'US VICE PRESIDENTS', desc: '49 VPs · name, number & president served' },
    { id: 'astronomy', emoji: '🪐', label: 'PLANETS & ASTRONOMY', desc: 'Solar system, moons & space facts' },
    { id: 'shakespeare', emoji: '🎭', label: 'SHAKESPEARE', desc: 'Plays, characters & quotes' },
    { id: 'authors', emoji: '📚', label: 'FAMOUS AUTHORS', desc: 'Authors and their major works' },
    { id: 'painters', emoji: '🎨', label: 'FAMOUS PAINTERS', desc: 'Artists, paintings & movements' },
    { id: 'composers', emoji: '🎼', label: 'CLASSICAL COMPOSERS', desc: 'Composers, works & eras' },
    { id: 'ballets', emoji: '🩰', label: 'FAMOUS BALLETS', desc: 'Ballets, composers & characters' },
    { id: 'greek_latin_roots', emoji: '📜', label: 'GREEK & LATIN ROOTS', desc: 'Roots, meanings & example words' },
  ]

  return (
    <div style={{ ...S.wrap, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <button style={{ fontSize: 12, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer' }} onClick={onBack}>← Back</button>
        <div style={S.title}>🧠 KNOWLEDGE</div>
      </div>
      {knowledgeDrills.map(d => {
        const history = stats[d.id] || []
        const best = history.length > 0 ? Math.max(...history.map(s => s.pct)) : null
        return (
          <button key={d.id} style={{ ...S.card, textAlign: 'left', cursor: 'pointer', border: '1px solid #1a2460', width: '100%', padding: '10px 14px' }} onClick={() => onSelect(d.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: '#f5c518', letterSpacing: 2 }}>{d.emoji} {d.label}</div>
                <div style={{ fontSize: 10, color: '#4060a0', marginTop: 1 }}>{d.desc}</div>
              </div>
              {best !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: best >= 80 ? '#4caf7d' : best >= 60 ? '#f5c518' : '#e57373' }}>{best}%</div>
                  <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1 }}>BEST</div>
                </div>
              )}
            </div>
            {history.slice(0,3).map((s, j) => (
              <span key={j} style={{ fontSize: 9, color: s.pct >= 80 ? '#4caf7d' : s.pct >= 60 ? '#f5c518' : '#e57373', background: '#060b1a', borderRadius: 4, padding: '2px 6px', border: '1px solid #1a2040', marginRight: 4, display: 'inline-block', marginTop: 6 }}>
                {s.pct}% · {s.date}
              </span>
            ))}
          </button>
        )
      })}
    </div>
  )
}

// ─── Geography Hub ────────────────────────────────────────────────────────────
function GeographyHub({ onBack, onSelect, stats, worldLoading }) {
  const geoDrills = [
    { id: 'worldmap', emoji: '🌍', label: 'WORLD MAP', desc: '195 countries · name & capital' },
    { id: null, isHeader: true, label: '── REGIONAL ──' },
    { id: 'region-europe', emoji: '🇪🇺', label: 'EUROPE', desc: `${REGIONS.europe.ids.size} countries` },
    { id: 'region-asia', emoji: '🌏', label: 'ASIA', desc: `${REGIONS.asia.ids.size} countries` },
    { id: 'region-africa', emoji: '🌍', label: 'AFRICA', desc: `${REGIONS.africa.ids.size} countries` },
    { id: 'region-south_america', emoji: '🌎', label: 'SOUTH AMERICA', desc: `${REGIONS.south_america.ids.size} countries` },
    { id: 'region-oceania', emoji: '🌊', label: 'OCEANIA', desc: `${REGIONS.oceania.ids.size} countries` },
    { id: 'region-central_america', emoji: '🌴', label: 'CENTRAL AMERICA & CARIBBEAN', desc: `${REGIONS.central_america.ids.size} countries` },
    { id: null, isHeader: true, label: '── SUBNATIONAL ──' },
    { id: 'us-states', emoji: '🗺', label: 'US STATES', desc: '50 states & capitals' },
    { id: 'canada', emoji: '🍁', label: 'CANADA', desc: '13 provinces & territories' },
    { id: 'mexico', emoji: '🇲🇽', label: 'MEXICO', desc: '32 states & capitals' },
  ]

  return (
    <div style={{ ...S.wrap, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <button style={{ fontSize: 12, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer' }} onClick={onBack}>← Back</button>
        <div style={S.title}>GEOGRAPHY</div>
      </div>
      {worldLoading && <div style={{ fontSize: 10, color: '#4060a0', letterSpacing: 2, textAlign: 'center' }}>Loading world map data...</div>}

      {geoDrills.map((d, i) => {
        if (d.isHeader) return (
          <div key={i} style={{ fontSize: 9, color: '#2a3460', letterSpacing: 3, textAlign: 'center', padding: '4px 0' }}>{d.label}</div>
        )
        const history = stats[d.id] || []
        const best = history.length > 0 ? Math.max(...history.map(s => s.pct)) : null
        return (
          <button key={d.id} style={{ ...S.card, textAlign: 'left', cursor: 'pointer', border: '1px solid #1a2460', width: '100%', padding: '10px 14px' }} onClick={() => onSelect(d.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: '#f5c518', letterSpacing: 2 }}>{d.emoji} {d.label}</div>
                <div style={{ fontSize: 10, color: '#4060a0', marginTop: 1 }}>{d.desc}</div>
              </div>
              {best !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: best >= 80 ? '#4caf7d' : best >= 60 ? '#f5c518' : '#e57373' }}>{best}%</div>
                  <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1 }}>BEST</div>
                </div>
              )}
            </div>
            {history.slice(0,3).map((s, j) => (
              <span key={j} style={{ fontSize: 9, color: s.pct >= 80 ? '#4caf7d' : s.pct >= 60 ? '#f5c518' : '#e57373', background: '#060b1a', borderRadius: 4, padding: '2px 6px', border: '1px solid #1a2040', marginRight: 4, display: 'inline-block', marginTop: 6 }}>
                {s.pct}% · {s.date}
              </span>
            ))}
          </button>
        )
      })}
    </div>
  )
}

// ─── Region Definitions ───────────────────────────────────────────────────────
const REGIONS = {
  europe: {
    label: 'Europe',
    ids: new Set(['ALB','AND','ARM','AUT','AZE','BLR','BEL','BIH','BGR','HRV','CYP','CZE','DNK','EST','FIN','FRA','GEO','DEU','GRC','HUN','ISL','IRL','ITA','XKX','LVA','LIE','LTU','LUX','MLT','MDA','MCO','MNE','NLD','MKD','NOR','POL','PRT','ROU','RUS','SMR','SRB','SVK','SVN','ESP','SWE','CHE','UKR','GBR','VAT']),
  },
  asia: {
    label: 'Asia',
    ids: new Set(['AFG','ARM','AZE','BHR','BGD','BTN','BRN','KHM','CHN','GEO','IND','IDN','IRN','IRQ','ISR','JPN','JOR','KAZ','KWT','KGZ','LAO','LBN','MYS','MDV','MNG','MMR','NPL','PRK','OMN','PAK','PHL','QAT','SAU','SGP','LKA','SYR','TWN','TJK','THA','TLS','TUR','TKM','ARE','UZB','VNM','YEM']),
  },
  africa: {
    label: 'Africa',
    ids: new Set(['DZA','AGO','BEN','BWA','BFA','BDI','CPV','CMR','CAF','TCD','COM','COD','COG','DJI','EGY','GNQ','ERI','ETH','GAB','GMB','GHA','GIN','GNB','KEN','LSO','LBR','LBY','MDG','MWI','MLI','MRT','MUS','MAR','MOZ','NAM','NER','NGA','RWA','STP','SEN','SYC','SLE','SOM','ZAF','SSD','SDN','TZA','TGO','TUN','UGA','ZMB','ZWE']),
  },
  south_america: {
    label: 'South America',
    ids: new Set(['ARG','BOL','BRA','CHL','COL','ECU','GUY','PRY','PER','SUR','URY','VEN']),
  },
  oceania: {
    label: 'Oceania',
    ids: new Set(['AUS','FJI','KIR','MHL','FSM','NRU','NZL','PLW','PNG','WSM','SLB','TON','TUV','VUT']),
  },
  central_america: {
    label: 'Central America & Caribbean',
    ids: new Set([
      // Central America
      'BLZ','GTM','HND','SLV','NIC','CRI','PAN','MEX',
      // Caribbean
      'CUB','JAM','HTI','DOM','PRI','TTO','BRB','LCA','VCT','GRD','ATG','DMA','KNA','BHS',
    ]),
  },
}

// ─── Sub-national Data ────────────────────────────────────────────────────────
const US_STATES = [
  { name: 'Alabama', capital: 'Montgomery' }, { name: 'Alaska', capital: 'Juneau' },
  { name: 'Arizona', capital: 'Phoenix' }, { name: 'Arkansas', capital: 'Little Rock' },
  { name: 'California', capital: 'Sacramento' }, { name: 'Colorado', capital: 'Denver' },
  { name: 'Connecticut', capital: 'Hartford' }, { name: 'Delaware', capital: 'Dover' },
  { name: 'Florida', capital: 'Tallahassee' }, { name: 'Georgia', capital: 'Atlanta' },
  { name: 'Hawaii', capital: 'Honolulu' }, { name: 'Idaho', capital: 'Boise' },
  { name: 'Illinois', capital: 'Springfield' }, { name: 'Indiana', capital: 'Indianapolis' },
  { name: 'Iowa', capital: 'Des Moines' }, { name: 'Kansas', capital: 'Topeka' },
  { name: 'Kentucky', capital: 'Frankfort' }, { name: 'Louisiana', capital: 'Baton Rouge' },
  { name: 'Maine', capital: 'Augusta' }, { name: 'Maryland', capital: 'Annapolis' },
  { name: 'Massachusetts', capital: 'Boston' }, { name: 'Michigan', capital: 'Lansing' },
  { name: 'Minnesota', capital: 'Saint Paul' }, { name: 'Mississippi', capital: 'Jackson' },
  { name: 'Missouri', capital: 'Jefferson City' }, { name: 'Montana', capital: 'Helena' },
  { name: 'Nebraska', capital: 'Lincoln' }, { name: 'Nevada', capital: 'Carson City' },
  { name: 'New Hampshire', capital: 'Concord' }, { name: 'New Jersey', capital: 'Trenton' },
  { name: 'New Mexico', capital: 'Santa Fe' }, { name: 'New York', capital: 'Albany' },
  { name: 'North Carolina', capital: 'Raleigh' }, { name: 'North Dakota', capital: 'Bismarck' },
  { name: 'Ohio', capital: 'Columbus' }, { name: 'Oklahoma', capital: 'Oklahoma City' },
  { name: 'Oregon', capital: 'Salem' }, { name: 'Pennsylvania', capital: 'Harrisburg' },
  { name: 'Rhode Island', capital: 'Providence' }, { name: 'South Carolina', capital: 'Columbia' },
  { name: 'South Dakota', capital: 'Pierre' }, { name: 'Tennessee', capital: 'Nashville' },
  { name: 'Texas', capital: 'Austin' }, { name: 'Utah', capital: 'Salt Lake City' },
  { name: 'Vermont', capital: 'Montpelier' }, { name: 'Virginia', capital: 'Richmond' },
  { name: 'Washington', capital: 'Olympia' }, { name: 'West Virginia', capital: 'Charleston' },
  { name: 'Wisconsin', capital: 'Madison' }, { name: 'Wyoming', capital: 'Cheyenne' },
]

const CANADA_PROVINCES = [
  { name: 'Alberta', capital: 'Edmonton' }, { name: 'British Columbia', capital: 'Victoria' },
  { name: 'Manitoba', capital: 'Winnipeg' }, { name: 'New Brunswick', capital: 'Fredericton' },
  { name: 'Newfoundland and Labrador', capital: "St. John's" }, { name: 'Nova Scotia', capital: 'Halifax' },
  { name: 'Northwest Territories', capital: 'Yellowknife' }, { name: 'Nunavut', capital: 'Iqaluit' },
  { name: 'Ontario', capital: 'Toronto' }, { name: 'Prince Edward Island', capital: 'Charlottetown' },
  { name: 'Quebec', capital: 'Quebec City' }, { name: 'Saskatchewan', capital: 'Regina' },
  { name: 'Yukon', capital: 'Whitehorse' },
]

const MEXICO_STATES = [
  { name: 'Aguascalientes', capital: 'Aguascalientes' }, { name: 'Baja California', capital: 'Mexicali' },
  { name: 'Baja California Sur', capital: 'La Paz' }, { name: 'Campeche', capital: 'Campeche' },
  { name: 'Chiapas', capital: 'Tuxtla Gutiérrez' }, { name: 'Chihuahua', capital: 'Chihuahua' },
  { name: 'Coahuila', capital: 'Saltillo' }, { name: 'Colima', capital: 'Colima' },
  { name: 'Durango', capital: 'Victoria de Durango' }, { name: 'Guanajuato', capital: 'Guanajuato' },
  { name: 'Guerrero', capital: 'Chilpancingo' }, { name: 'Hidalgo', capital: 'Pachuca' },
  { name: 'Jalisco', capital: 'Guadalajara' }, { name: 'Mexico City', capital: 'Mexico City' },
  { name: 'México', capital: 'Toluca' }, { name: 'Michoacán', capital: 'Morelia' },
  { name: 'Morelos', capital: 'Cuernavaca' }, { name: 'Nayarit', capital: 'Tepic' },
  { name: 'Nuevo León', capital: 'Monterrey' }, { name: 'Oaxaca', capital: 'Oaxaca' },
  { name: 'Puebla', capital: 'Puebla' }, { name: 'Querétaro', capital: 'Querétaro' },
  { name: 'Quintana Roo', capital: 'Chetumal' }, { name: 'San Luis Potosí', capital: 'San Luis Potosí' },
  { name: 'Sinaloa', capital: 'Culiacán' }, { name: 'Sonora', capital: 'Hermosillo' },
  { name: 'Tabasco', capital: 'Villahermosa' }, { name: 'Tamaulipas', capital: 'Ciudad Victoria' },
  { name: 'Tlaxcala', capital: 'Tlaxcala' }, { name: 'Veracruz', capital: 'Xalapa' },
  { name: 'Yucatán', capital: 'Mérida' }, { name: 'Zacatecas', capital: 'Zacatecas' },
]

// ─── Generic Sub-national Map ─────────────────────────────────────────────────
function SubnationalMapDrill({ config, onBack, cards = [], setCards = () => {} }) {
  const [paths, setPaths] = useState([])
  const [centroids, setCentroids] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [answer, setAnswer] = useState({ region: '', capital: '' })
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [attempted, setAttempted] = useState(new Set())
  const [showReference, setShowReference] = useState(false)
  const [attemptResults, setAttemptResults] = useState({})
  const [refMode, setRefMode] = useState('map')
  const [revealed, setRevealed] = useState(new Set())
  const subDrillId = config.regionLabel === 'State' ? 'us-states' : config.regionLabel === 'Province' ? 'canada' : 'mexico'
  const [missCounts, setMissCounts] = useState(() => getDrillMissCounts(subDrillId))
  const [autoNext, setAutoNext] = useState(false)
  const sessionSavedSub = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [minZoom, setMinZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const [listSearch, setListSearch] = useState('')
  const inputRef = useRef(null)
  const dataMap = useRef({})

  // Build data lookup by normalized name
  useEffect(() => {
    const map = {}
    config.data.forEach(d => { map[d.name.toLowerCase()] = d })
    dataMap.current = map
  }, [config])

  useEffect(() => {
    setLoading(true)
    fetch(config.geojsonUrl)
      .then(r => r.json())
      .then(geo => {
        const w = config.width || 960, h = config.height || 500
        const [minLon, maxLon, minLat, maxLat] = config.bounds || [-180, 180, -90, 90]
        const project = ([lon, lat]) => [
          (lon - minLon) / (maxLon - minLon) * w,
          (maxLat - lat) / (maxLat - minLat) * h,
        ]
        function toPath(coords) {
          return coords.map(ring => ring.map((pt, pi) => {
            const [x, y] = project(pt)
            return `${pi === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          }).join(' ') + ' Z').join(' ')
        }
        function getCentroid(coords) {
          const ring = coords[0]
          const pts = ring.map(p => project(p))
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
          return {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
          }
        }
        // For US states: reposition Alaska and Hawaii as insets
        const isUS = config.regionLabel === 'State' && config.bounds?.[0] === -125

        // Transform projected [x,y] coords for AK/HI insets
        // Alaska raw projects to ~x:-600..-350, y:-350..-180
        // We want it at x:30..180, y:400..520 (bottom-left inset, scaled ~30%)
        // Hawaii raw projects to ~x:-600..-490, y:580..680
        // We want it at x:200..320, y:440..520 (bottom-center-left inset)
        function transformProjected([x, y], name) {
          if (!isUS) return [x, y]
          if (name === 'Alaska') {
            const scale = 0.31
            // raw AK center ~x=-450, y=-260; target center ~x=105, y=460
            return [x * scale + 105 + 450 * scale, y * scale + 460 + 260 * scale]
          }
          if (name === 'Hawaii') {
            // raw HI center ~x=-545, y=635; target center ~x=260, y=480
            return [x + 545 + 260, y - 635 + 480]
          }
          return [x, y]
        }

        function transformCoords(coords, name) {
          if (!isUS || (name !== 'Alaska' && name !== 'Hawaii')) return coords
          return coords.map(ring => ring.map(pt => {
            const [px, py] = project(pt)
            const [tx, ty] = transformProjected([px, py], name)
            // We need to return lon/lat that projects to tx,ty
            // Reverse projection: lon = tx/w*(maxLon-minLon)+minLon, lat = maxLat-ty/h*(maxLat-minLat)
            return [tx / w * (maxLon - minLon) + minLon, maxLat - ty / h * (maxLat - minLat)]
          }))
        }

        function transformMultiCoords(coordsArray, name) {
          return coordsArray.map(c => transformCoords(c, name))
        }

        const newCentroids = {}
        const built = geo.features.map(f => {
          const name = f.properties?.name || f.properties?.NAME || ''
          let d = '', centroid = null
          if (f.geometry?.type === 'Polygon') {
            const transformed = transformCoords(f.geometry.coordinates, name)
            d = toPath(transformed)
            centroid = getCentroid(transformed)
          } else if (f.geometry?.type === 'MultiPolygon') {
            const transformed = transformMultiCoords(f.geometry.coordinates, name)
            d = transformed.map(p => toPath(p)).join(' ')
            const largest = transformed.reduce((a,b) => b[0].length > a[0].length ? b : a)
            centroid = getCentroid(largest)
          }
          if (centroid) newCentroids[name] = centroid
          return { name, d }
        }).filter(p => p.d)
        setPaths(built)
        setCentroids(newCentroids)
        setLoading(false)
        // Auto-fit: center and zoom to fill
        // Exclude outlier centroids (beyond viewport) from fit calculation
        const vw2 = config.width || 960, vh2 = config.height || 500
        const allCs = Object.values(newCentroids)
        if (allCs.length) {
          // Filter to centroids within 120% of viewport to exclude outliers like AK/HI
          const cs = allCs.filter(c => c.x >= -vw2*0.2 && c.x <= vw2*1.2 && c.y >= -vh2*0.2 && c.y <= vh2*1.2)
          const usableCs = cs.length > 3 ? cs : allCs
          const xs = usableCs.map(c => c.x), ys = usableCs.map(c => c.y)
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2
          const spanX = Math.max(...xs) - Math.min(...xs)
          const spanY = Math.max(...ys) - Math.min(...ys)
          const newZoom = Math.min(Math.max(Math.min(vw2 * 0.68 / (spanX||1), vh2 * 0.65 / (spanY||1)), 1), 8)
          setZoom(newZoom)
          setMinZoom(newZoom)
          setPan({ x: vw2/2 - cx * newZoom, y: vh2/2 - cy * newZoom })
        }
      })
      .catch(err => { setLoadError(err.message || 'Failed to load'); setLoading(false) })
  }, [config])

  function getRegionData(name) {
    return dataMap.current[name?.toLowerCase()] || null
  }

  function handleClick(name) {
    if (!getRegionData(name) || attempted.has(name)) return
    setSelected(name)
    setAnswer({ region: '', capital: '' })
    setResult(null)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function checkAnswer() {
    const data = getRegionData(selected)
    if (!data) return
    const regionCorrect = fuzzyMatch(answer.region, data.name)
    const capitalCorrect = fuzzyMatch(answer.capital, data.capital)
    const both = regionCorrect && capitalCorrect
    setResult({ regionCorrect, capitalCorrect, data })
    setAttempted(prev => new Set([...prev, selected]))
    const newResults = { ...attemptResults, [selected]: { correct: both, regionCorrect, capitalCorrect, data } }
    setAttemptResults(newResults)
    const newScore = { correct: score.correct + (both ? 1 : 0), total: score.total + 1 }
    setScore(newScore)
    if (config.data.length - attempted.size - 1 === 0 && !sessionSavedSub.current) {
      sessionSavedSub.current = true
      saveDrillSession(subDrillId, newScore.correct, newScore.total)
      saveDrillMisses(subDrillId, Object.entries(newResults).filter(([,r]) => !r.correct).map(([name]) => name))
      setMissCounts(getDrillMissCounts(subDrillId))
    }
    if (autoNext) setTimeout(() => { setSelected(null); setResult(null); autoSelectNext() }, 1200)
  }

  function markItemCorrect(field) {
    if (!result) return
    const updated = { ...result, [field + 'Correct']: true }
    setResult(updated)
    setAttemptResults(prev => ({ ...prev, [selected]: { ...prev[selected], [field + 'Correct']: true, correct: !!(updated.regionCorrect && updated.capitalCorrect) } }))
    if (updated.regionCorrect && updated.capitalCorrect) setScore(prev => ({ ...prev, correct: prev.correct + 1 }))
  }

  function autoSelectNext() {
    const unattempted = config.data.filter(d => !attempted.has(d.name))
    if (!unattempted.length) return
    const curCentroid = selected && centroids[selected] ? centroids[selected] : { x: 0, y: 0 }
    const withC = unattempted.map(d => ({ ...d, c: centroids[d.name] })).filter(d => d.c)
    if (!withC.length) { handleClick(unattempted[0].name); return }
    let east = withC.filter(d => d.c.x > curCentroid.x + 10)
    if (!east.length) east = withC
    east.sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y)
    handleClick(east[0].name)
    const c = east[0].c
    setPan({ x: -(c.x * zoom - (config.width || 960) / 2), y: -(c.y * zoom - (config.height || 500) / 2) })
  }

  const remaining = config.data.length - attempted.size
  const vw = config.width || 960, vh = config.height || 500

  const filteredList = config.data
    .filter(d => !listSearch || d.name.toLowerCase().includes(listSearch.toLowerCase()) || d.capital.toLowerCase().includes(listSearch.toLowerCase()))
    .sort((a,b) => a.name.localeCompare(b.name))

  if (showReference) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
        <button style={{ fontSize: 12, color: '#4060a0', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowReference(false)}>← Back</button>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['map', '🗺 Map'], ['list', '📋 List']].map(([v, l]) => (
            <button key={v} onClick={() => setRefMode(v)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${refMode === v ? '#f5c518' : '#1a2460'}`, background: refMode === v ? 'rgba(245,197,24,0.1)' : '#060b1a', color: refMode === v ? '#f5c518' : '#6070a0', cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
      </div>
      {refMode === 'map' && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => setZoom(z => Math.min(z*1.5,8))}>+</button>
            <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18, opacity: zoom <= minZoom ? 0.3 : 1 }} disabled={zoom <= minZoom} onClick={() => { const nz = Math.max(zoom/1.5, 1); setZoom(nz); if (nz === 1) setPan({x:0,y:0}) }}>−</button>
            <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11 }} onClick={() => { setZoom(minZoom); setPan({x:0,y:0}) }}>Reset</button>
            <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11, color:'#4dd0e1' }} onClick={() => setRevealed(new Set(config.data.map(d=>d.name)))}>Show All</button>
            <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11 }} onClick={() => setRevealed(new Set())}>Hide All</button>
          </div>
          <div
            style={{ width:'100%', background:'#060b1a', borderRadius:12, overflow:'hidden', border:'1px solid #1a2460', cursor: dragging?'grabbing':'grab', userSelect:'none' }}
            onMouseDown={e => { setDragging(true); setDragStart({x:e.clientX-pan.x,y:e.clientY-pan.y}) }}
            onMouseMove={e => { if(dragging&&dragStart) setPan({x:e.clientX-dragStart.x,y:e.clientY-dragStart.y}) }}
            onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}
            onTouchStart={e => { const t=e.touches[0]; setDragging(true); setDragStart({x:t.clientX-pan.x,y:t.clientY-pan.y}) }}
            onTouchMove={e => { if(dragging&&dragStart){const t=e.touches[0];setPan({x:t.clientX-dragStart.x,y:t.clientY-dragStart.y})} }}
            onTouchEnd={() => setDragging(false)}
          >
            <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width:'100%', height:'auto', display:'block' }}>
              <rect width={vw} height={vh} fill="#060b1a" />
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                {paths.map(p => {
                  const data = getRegionData(p.name)
                  const isRevealed = revealed.has(p.name)
                  return (
                    <path key={p.name} d={p.d}
                      fill={isRevealed ? '#4dd0e1' : data ? '#1a3070' : '#0d1a3a'}
                      stroke="#0a0f2e" strokeWidth={0.5/zoom}
                      onClick={e => { if(!dragging&&data){e.stopPropagation();setRevealed(prev=>{const n=new Set(prev);n.has(p.name)?n.delete(p.name):n.add(p.name);return n})} }}
                      style={{ cursor:data?'pointer':'default', transition:'fill 0.2s' }}
                    />
                  )
                })}
                {paths.map(p => {
                  const data = getRegionData(p.name)
                  const c = centroids[p.name]
                  if (!data || !c) return null
                  const isRevealed = revealed.has(p.name)
                  if (!isRevealed && zoom < minZoom * 1.5) return null
                  return (
                    <g key={`l-${p.name}`} onClick={e => { if(!dragging){e.stopPropagation();setRevealed(prev=>{const n=new Set(prev);n.has(p.name)?n.delete(p.name):n.add(p.name);return n})} }} style={{ cursor:'pointer' }}>
                      <text x={c.x} y={c.y-(isRevealed?5:0)} textAnchor="middle" fontSize={10/zoom} fill={isRevealed?'#fff':'#8890d0'} style={{ pointerEvents:'none', fontFamily:'sans-serif' }}>{p.name}</text>
                      {isRevealed && <text x={c.x} y={c.y+8/zoom} textAnchor="middle" fontSize={8/zoom} fill="#f5c518" style={{ pointerEvents:'none', fontFamily:'sans-serif' }}>{data.capital}</text>}
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        </>
      )}
      {refMode === 'list' && (
        <>
          <input style={S.input} value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Search..." />
          <div style={{ ...S.card, padding:0, overflow:'hidden', maxHeight:500, overflowY:'auto' }}>
            {filteredList.map((d,i) => (
              <div key={d.name} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom:i<filteredList.length-1?'1px solid #0d1235':'none', background:revealed.has(d.name)?'rgba(77,208,225,0.06)':i%2===0?'transparent':'#060b1a', cursor:'pointer' }} onClick={() => setRevealed(prev=>{const n=new Set(prev);n.has(d.name)?n.delete(d.name):n.add(d.name);return n})}>
                <div style={{ flex:1 }}>
                  <span style={{ fontSize:13, color: missCounts[d.name] > 0 ? '#ffb3b3' : '#c0c8e8' }}>{d.name}</span>
                  {missCounts[d.name] > 0 && <span style={{ display:'inline-flex', gap:2, marginLeft:4, verticalAlign:'middle' }}>{[0,1,2].map(i=><span key={i} style={{ width:6, height:6, borderRadius:'50%', background: i<missCounts[d.name]?'#e57373':'#1a2460', display:'inline-block' }}/>)}</span>}
                  {revealed.has(d.name) && <span style={{ fontSize:12, color:'#f5c518', marginLeft:10 }}>→ {d.capital}</span>}
                </div>
                <span style={{ fontSize:10, color:'#2a3460' }}>{revealed.has(d.name)?'▲':'▼'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )

  if (loading) return <div style={{ ...S.wrap, alignItems:'center', padding:40 }}><div style={{ color:'#4060a0', fontSize:13 }}>Loading map...</div></div>
  if (loadError || paths.length === 0) return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={{ color:'#e57373', fontSize:13, marginBottom:6 }}>Failed to load map.</div>
        <div style={{ color:'#4060a0', fontSize:11 }}>{loadError || 'No map data received.'}</div>
      </div>
      <button style={S.btnSecondary} onClick={onBack}>← Back</button>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 4px' }}>
        <button style={{ fontSize:12, color:'#4060a0', background:'none', border:'none', cursor:'pointer' }} onClick={onBack}>← Back</button>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button style={{ fontSize:11, color:'#4dd0e1', background:'none', border:'none', cursor:'pointer' }} onClick={() => setShowReference(true)}>📋 Reference</button>
          <div style={{ fontSize:11, color:'#4060a0', letterSpacing:2 }}>{score.correct}/{score.total} · {remaining} left</div>
          {remaining === 0 && Object.entries(attemptResults).some(([,r]) => !r.correct) && (
            <button style={{ fontSize:10, color:'#4caf7d', border:'1px solid #2e8c50', borderRadius:6, padding:'2px 8px', background:'#0a1e10', cursor:'pointer' }} onClick={() => {
              const missed = Object.entries(attemptResults).filter(([,r]) => !r.correct).map(([name, r]) => {
                const p = paths.find(p => p.name === name)
                const img = p ? makeMapSnapshot(p, paths) : null
                const card = makeFlashCard(img ? `[Map] ${name}` : name, `${name} · Capital: ${r.data.capital}`, config.regionLabel === 'State' ? 'US States' : `Geography · ${config.regionLabel}`)
                if (img) card.image = img
                return card
              })
              const freshCards = loadCards()
              const existing = new Set(freshCards.map(c => c.front))
              const newCards = missed.filter(c => !existing.has(c.front))
              if (newCards.length) {
                const updated = [...freshCards, ...newCards]
                try {
                  saveCards(updated)
                  setCards(updated)
                  alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck`)
                } catch {
                  const stripped = newCards.map(c => { const {image, ...rest} = c; return rest })
                  const updated2 = [...freshCards, ...stripped]
                  saveCards(updated2); setCards(updated2)
                  alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck (without map images - storage full)`)
                }
              } else { alert('No new cards to add') }
            }}>+ Add missed ({Object.entries(attemptResults).filter(([,r]) => !r.correct).length})</button>
          )}
        </div>
      </div>

      <div style={{ display:'flex', gap:6 }}>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18 }} onClick={() => { const nz=Math.min(zoom*1.5,8); const cx=(480-pan.x)/zoom; const cy=(250-pan.y)/zoom; setPan({x:480-cx*nz,y:250-cy*nz}); setZoom(nz) }}>+</button>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18, opacity:zoom<=minZoom?0.3:1 }} disabled={zoom<=minZoom} onClick={() => { const nz=Math.max(zoom/1.5,minZoom); setZoom(nz); if(nz<=minZoom){setZoom(minZoom);setPan({x:0,y:0})} }}>−</button>
        <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:12 }} onClick={() => { setZoom(minZoom); setPan({x:0,y:0}) }}>Reset</button>
        <button style={{ ...S.btn, flex:1, padding:'6px 0', fontSize:12, background: autoNext ? 'rgba(245,197,24,0.15)' : undefined, border: autoNext ? '1px solid #f5c518' : undefined }} onClick={() => setAutoNext(a => !a)}>Auto Next {autoNext ? '✓' : '→'}</button>
      </div>

      <div
        style={{ width:'100%', background:'#060b1a', borderRadius:12, overflow:'hidden', border:'1px solid #1a2460', cursor:dragging?'grabbing':'grab', userSelect:'none', position:'relative' }}
        onMouseDown={e => { setDragging(true); setDragStart({x:e.clientX-pan.x,y:e.clientY-pan.y}) }}
        onMouseMove={e => { if(dragging&&dragStart) setPan({x:e.clientX-dragStart.x,y:e.clientY-dragStart.y}) }}
        onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}
        onTouchStart={e => { const t=e.touches[0]; setDragging(true); setDragStart({x:t.clientX-pan.x,y:t.clientY-pan.y}) }}
        onTouchMove={e => { if(dragging&&dragStart){const t=e.touches[0];setPan({x:t.clientX-dragStart.x,y:t.clientY-dragStart.y})} }}
        onTouchEnd={() => setDragging(false)}
      >
        <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width:'100%', height:'auto', display:'block' }}>
          <rect width={vw} height={vh} fill="#060b1a" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {paths.map(p => {
              const data = getRegionData(p.name)
              const isAttempted = attempted.has(p.name)
              return (
                <path key={p.name} d={p.d}
                  fill={p.name===selected?'#f5c518':isAttempted?'#e0e0e0':data?'#1a3070':'#0d1a3a'}
                  stroke="#0a0f2e" strokeWidth={0.5/zoom}
                  onClick={e => { if(!dragging){e.stopPropagation();handleClick(p.name)} }}
                  style={{ cursor:data&&!isAttempted?'pointer':'default', transition:'fill 0.15s' }}
                />
              )
            })}
          {/* Permanent labels for attempted regions */}
          {paths.map(p => {
            const res = attemptResults[p.name]
            const c = centroids[p.name]
            if (!res || !c) return null
            return (
              <g key={`lbl-${p.name}`} style={{ pointerEvents: 'none' }}>
                <text x={c.x} y={c.y - 4/zoom} textAnchor="middle" fontSize={8/zoom} fill={res.regionCorrect ? '#4caf7d' : '#e53935'} fontWeight="bold" fontFamily="sans-serif">{p.name}</text>
                <text x={c.x} y={c.y + 6/zoom} textAnchor="middle" fontSize={7/zoom} fill={res.capitalCorrect ? '#4caf7d' : '#e53935'} fontFamily="sans-serif">{res.data.capital}</text>
              </g>
            )
          })}
          </g>
        </svg>
      </div>

      {selected && (
        <div style={S.card}>
          {result ? (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <span style={result.regionCorrect?S.correct:S.incorrect}>{result.regionCorrect?'✓':'✗'} {config.regionLabel}: {result.data.name}</span>
                {!result.regionCorrect && <button style={{ fontSize:10, color:'#4caf7d', border:'1px solid #2e8c50', borderRadius:6, padding:'2px 8px', background:'#0a1e10', cursor:'pointer' }} onClick={() => markItemCorrect('region')}>Mark correct</button>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={result.capitalCorrect?S.correct:S.incorrect}>{result.capitalCorrect?'✓':'✗'} Capital: {result.data.capital}</span>
                {!result.capitalCorrect && <button style={{ fontSize:10, color:'#4caf7d', border:'1px solid #2e8c50', borderRadius:6, padding:'2px 8px', background:'#0a1e10', cursor:'pointer' }} onClick={() => markItemCorrect('capital')}>Mark correct</button>}
              </div>
              <button style={{ fontSize:10, color:'#4dd0e1', border:'1px solid #1a4060', borderRadius:6, padding:'3px 10px', background:'#0a1e20', cursor:'pointer', marginTop:6 }} onClick={() => {
                const data = getRegionData(selected)
                if (!data) return
                const freshCards = loadCards()
                const p = paths.find(p2 => p2.name === selected)
                const img = p ? makeMapSnapshot(p, paths) : null
                const front = img ? `[Map] ${selected}` : selected
                if (freshCards.some(c => c.front === front)) { alert('Already in deck'); return }
                const card = makeFlashCard(front, `${selected} · Capital: ${data.capital}`, config.regionLabel === 'State' ? 'US States' : 'Geography')
                if (img) card.image = img
                const updated = [...freshCards, card]; saveCards(updated); setCards(updated)
                alert(`Added ${selected} to deck`)
              }}>＋ Add to deck</button>
              <button style={{ ...S.btn, marginTop:12, fontSize:14 }} onClick={() => setSelected(null)}>TAP ANOTHER</button>
            </div>
          ) : (
            <div>
              <div style={S.subtitle}>IDENTIFY THIS {config.regionLabel.toUpperCase()}</div>
              <input ref={inputRef} style={{ ...S.input, marginTop:8, marginBottom:8 }} value={answer.region} onChange={e => setAnswer(a=>({...a,region:e.target.value}))} placeholder={`${config.regionLabel} name...`} />
              <input style={{ ...S.input, marginBottom:10 }} value={answer.capital} onChange={e => setAnswer(a=>({...a,capital:e.target.value}))} onKeyDown={e => { if(e.key==='Enter') checkAnswer() }} placeholder="Capital city..." />
              <button style={S.btn} onClick={() => checkAnswer()}>CHECK</button>
            </div>
          )}
        </div>
      )}
      {!selected && <div style={{ textAlign:'center', fontSize:12, color:'#2a3460', padding:'8px 0' }}>Tap any {config.regionLabel.toLowerCase()} on the map</div>}
    </div>
  )
}

// ─── Regional World Map ───────────────────────────────────────────────────────
// Tiny island nations that need a Caribbean inset view
const TINY_ISLANDS = new Set(['BRB','LCA','VCT','GRD','ATG','DMA','KNA','BHS','TTO','JAM'])
// Caribbean bounding box in equirectangular 960x500 coords
// lon: -90 to -59, lat: 8 to 28
const CARIB_BOUNDS = { minX: 190, maxX: 270, minY: 155, maxY: 215 }

function CaribbeanInset({ paths, selected, attempted, attemptResults }) {
  const { minX, maxX, minY, maxY } = CARIB_BOUNDS
  const w = maxX - minX, h = maxY - minY
  const scale = 3.5
  const vw = w * scale, vh = h * scale

  return (
    <div style={{ position:'absolute', bottom:8, right:8, width:vw, height:vh, background:'#060b1a', border:'2px solid #f5c518', borderRadius:8, overflow:'hidden', boxShadow:'0 2px 12px rgba(0,0,0,0.6)', zIndex:10 }}>
      <div style={{ fontSize:8, color:'#f5c518', letterSpacing:1, padding:'2px 6px', background:'rgba(0,0,0,0.5)', position:'absolute', top:0, left:0, zIndex:1 }}>CARIBBEAN</div>
      <svg width={vw} height={vh} viewBox={`${minX} ${minY} ${w} ${h}`} style={{ display:'block' }}>
        <rect x={minX} y={minY} width={w} height={h} fill="#060b1a" />
        {paths.filter(p => {
          // Only show paths that overlap the Caribbean bounds
          const coords = [...(p.d.matchAll(/[ML]([\d.]+),([\d.]+)/g) || [])].map(m => [+m[1], +m[2]])
          if (!coords.length) return false
          const xs = coords.map(c => c[0]), ys = coords.map(c => c[1])
          return Math.min(...xs) < maxX && Math.max(...xs) > minX && Math.min(...ys) < maxY && Math.max(...ys) > minY
        }).map(p => {
          const isSelected = p.id === selected
          const res = attemptResults[p.id]
          const fill = isSelected ? '#f5c518' : res ? '#e0e0e0' : attempted?.has(p.id) ? '#e0e0e0' : '#1a3070'
          return (
            <g key={p.id}>
              <path d={p.d} fill={fill} stroke="#0a0f2e" strokeWidth={0.3} />
              {isSelected && (
                <circle cx={(() => { const coords=[...p.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m=>[+m[1],+m[2]]); const xs=coords.map(c=>c[0]); return (Math.min(...xs)+Math.max(...xs))/2 })()} cy={(() => { const coords=[...p.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m=>[+m[1],+m[2]]); const ys=coords.map(c=>c[1]); return (Math.min(...ys)+Math.max(...ys))/2 })()} r={0.8} fill="#f5c518" />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function RegionalMapDrill({ regionKey, onBack, worldPaths, worldCentroids, cards = [], setCards = () => {} }) {
  const region = REGIONS[regionKey]
  const [revealed, setRevealed] = useState(new Set())
  const [selected, setSelected] = useState(null)
  const [answer, setAnswer] = useState({ country: '', capital: '' })
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [attempted, setAttempted] = useState(new Set())
  const [attemptResults, setAttemptResults] = useState({})
  const [missCounts, setMissCounts] = useState(() => getDrillMissCounts('region-' + regionKey))
  const [autoNext, setAutoNext] = useState(false)
  const sessionSavedReg = useRef(false)
  const [showReference, setShowReference] = useState(false)
  const [refMode, setRefMode] = useState('map')
  const [zoom, setZoom] = useState(1)
  const [minZoom, setMinZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const [listSearch, setListSearch] = useState('')
  const inputRef = useRef(null)

  // Filter paths to this region
  const regionPaths = worldPaths.filter(p => region.ids.has(p.id))
  const regionCountries = COUNTRIES.filter(c => region.ids.has(c.id))
  const remaining = regionCountries.length - attempted.size

  // Auto-center on region when paths load
  useEffect(() => {
    if (!regionPaths.length || !Object.keys(worldCentroids.current).length) return
    const cs = regionCountries.map(c => worldCentroids.current[c.id]).filter(Boolean)
    if (!cs.length) return
    const xs = cs.map(c => c.x), ys = cs.map(c => c.y)
    // Detect date-line crossing: if x-range > 600 (>half the map), region likely crosses antimeridian
    // In equirectangular, x=0 is lon=-180, x=960 is lon=180
    // For Oceania: shift xs > 500 leftward by 960 to wrap them
    const rawXSpan = Math.max(...xs) - Math.min(...xs)
    let adjXs = xs
    if (rawXSpan > 600) {
      // Wrap: move high-x centroids (eastern hemisphere) to negative side
      adjXs = xs.map(x => x > 480 ? x - 960 : x)
    }
    const minX = Math.min(...adjXs), maxX = Math.max(...adjXs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    let cx = (minX + maxX) / 2
    if (cx < 0) cx += 960 // wrap back to positive
    const cy = (minY + maxY) / 2
    const spanX = maxX - minX, spanY = maxY - minY
    const zx = 960 * 0.68 / (spanX || 1), zy = 500 * 0.65 / (spanY || 1)
    const newZoom = Math.min(Math.max(Math.min(zx, zy), 1), 8)
    setZoom(newZoom)
    setMinZoom(newZoom)
    setPan({ x: 480 - cx * newZoom, y: 250 - cy * newZoom })
  }, [worldPaths.length])

  function handleClick(id) {
    if (!COUNTRY_MAP[id] || attempted.has(id) || !region.ids.has(id)) return
    setSelected(id)
    setAnswer({ country: '', capital: '' })
    setResult(null)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function checkAnswer() {
    const country = COUNTRY_MAP[selected]
    if (!country) return
    const countryCorrect = fuzzyMatch(answer.country, country.name)
    const capitalCorrect = fuzzyMatch(answer.capital, country.capital)
    const both = countryCorrect && capitalCorrect
    setResult({ countryCorrect, capitalCorrect, country })
    setAttempted(prev => new Set([...prev, selected]))
    const newResults = { ...attemptResults, [selected]: { correct: both, countryCorrect, capitalCorrect, country } }
    setAttemptResults(newResults)
    const newScore = { correct: score.correct + (both ? 1 : 0), total: score.total + 1 }
    setScore(newScore)
    if (regionCountries.length - attempted.size - 1 === 0 && !sessionSavedReg.current) {
      sessionSavedReg.current = true
      saveDrillSession('region-' + regionKey, newScore.correct, newScore.total)
      saveDrillMisses('region-' + regionKey, Object.entries(newResults).filter(([,r]) => !r.correct).map(([id]) => id))
      setMissCounts(getDrillMissCounts('region-' + regionKey))
    }
    if (autoNext) setTimeout(() => { setSelected(null); setResult(null); autoSelectNext() }, 1200)
  }

  function markItemCorrect(field) {
    const updated = result ? { ...result, [field + 'Correct']: true } : null
    setResult(updated)
    setAttemptResults(prev => ({ ...prev, [selected]: { ...prev[selected], [field + 'Correct']: true, correct: !!(updated?.countryCorrect && updated?.capitalCorrect) } }))
    if (updated?.countryCorrect && updated?.capitalCorrect) setScore(prev => ({ ...prev, correct: prev.correct + 1 }))
  }

  function autoSelectNext() {
    const unattempted = regionCountries.filter(c => !attempted.has(c.id))
    if (!unattempted.length) return
    const curC = selected && worldCentroids.current[selected] ? worldCentroids.current[selected] : { x: 0, y: 0 }
    const withC = unattempted.map(c => ({ ...c, c: worldCentroids.current[c.id] })).filter(c => c.c)
    if (!withC.length) { handleClick(unattempted[0].id); return }
    let east = withC.filter(d => d.c.x > curC.x + 10)
    if (!east.length) east = withC
    east.sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y)
    handleClick(east[0].id)
    const c = east[0].c
    setPan({ x: -(c.x * zoom - 480), y: -(c.y * zoom - 250) })
  }

  const filteredList = regionCountries
    .filter(c => !listSearch || c.name.toLowerCase().includes(listSearch.toLowerCase()) || c.capital.toLowerCase().includes(listSearch.toLowerCase()))
    .sort((a,b) => a.name.localeCompare(b.name))

  if (showReference) return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%' }}>
      <div style={{ display:'flex', justifyContent:'space-between', padding:'0 4px' }}>
        <button style={{ fontSize:12, color:'#4060a0', background:'none', border:'none', cursor:'pointer' }} onClick={() => setShowReference(false)}>← Back</button>
        <div style={{ display:'flex', gap:6 }}>
          {[['map','🗺 Map'],['list','📋 List']].map(([v,l]) => (
            <button key={v} onClick={() => setRefMode(v)} style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:`1px solid ${refMode===v?'#f5c518':'#1a2460'}`, background:refMode===v?'rgba(245,197,24,0.1)':'#060b1a', color:refMode===v?'#f5c518':'#6070a0', cursor:'pointer' }}>{l}</button>
          ))}
        </div>
      </div>
      {refMode === 'map' && (
        <>
          <div style={{ display:'flex', gap:6 }}>
            <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18 }} onClick={() => { const nz=Math.min(zoom*1.5,8); const cx=(480-pan.x)/zoom; const cy=(250-pan.y)/zoom; setPan({x:480-cx*nz,y:250-cy*nz}); setZoom(nz) }}>+</button>
            <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18, opacity:zoom<=minZoom?0.3:1 }} disabled={zoom<=minZoom} onClick={() => { const nz=Math.max(zoom/1.5,minZoom); setZoom(nz); if(nz<=minZoom){setPan({x:0,y:0})} }}>−</button>
            <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11 }} onClick={() => { setZoom(minZoom); setPan({x:0,y:0}) }}>Reset</button>
            <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11, color:'#4dd0e1' }} onClick={() => setRevealed(new Set(regionCountries.map(c=>c.id)))}>Show All</button>
            <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11 }} onClick={() => setRevealed(new Set())}>Hide All</button>
          </div>
          <div
            style={{ width:'100%', background:'#060b1a', borderRadius:12, overflow:'hidden', border:'1px solid #1a2460', cursor:dragging?'grabbing':'grab', userSelect:'none', position:'relative' }}
            onMouseDown={e => { setDragging(true); setDragStart({x:e.clientX-pan.x,y:e.clientY-pan.y}) }}
            onMouseMove={e => { if(dragging&&dragStart) setPan({x:e.clientX-dragStart.x,y:e.clientY-dragStart.y}) }}
            onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}
            onTouchStart={e => { const t=e.touches[0]; setDragging(true); setDragStart({x:t.clientX-pan.x,y:t.clientY-pan.y}) }}
            onTouchMove={e => { if(dragging&&dragStart){const t=e.touches[0];setPan({x:t.clientX-dragStart.x,y:t.clientY-dragStart.y})} }}
            onTouchEnd={() => setDragging(false)}
          >
            <svg viewBox="0 0 960 500" style={{ width:'100%', height:'auto', display:'block' }}>
              <rect width="960" height="500" fill="#060b1a" />
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                {regionPaths.map(p => {
                  const country = COUNTRY_MAP[p.id]
                  const isRevealed = revealed.has(p.id)
                  const c = worldCentroids.current[p.id]
                  return (
                    <g key={p.id}>
                      <path d={p.d} fill={isRevealed?'#4dd0e1':'#1a3070'} stroke="#0a0f2e" strokeWidth={0.5/zoom}
                        onClick={e => { if(!dragging) { e.stopPropagation(); setRevealed(prev => { const n=new Set(prev); n.has(p.id)?n.delete(p.id):n.add(p.id); return n }) } }}
                        style={{ cursor:'pointer', transition:'fill 0.2s' }}
                      />
                      {c && country && (isRevealed || zoom >= minZoom * 1.5) && (
                        <g onClick={e => { if(!dragging){e.stopPropagation();setRevealed(prev => { const n=new Set(prev); n.has(p.id)?n.delete(p.id):n.add(p.id); return n })} }} style={{ cursor:'pointer' }}>
                          <text x={c.x} y={c.y-(isRevealed?5:0)} textAnchor="middle" fontSize={8/zoom} fill={isRevealed?'#fff':'#8890d0'} style={{ pointerEvents:'none', fontFamily:'sans-serif' }}>{country.name}</text>
                          {isRevealed && <text x={c.x} y={c.y+10/zoom} textAnchor="middle" fontSize={7/zoom} fill="#f5c518" style={{ pointerEvents:'none', fontFamily:'sans-serif' }}>{country.capital}</text>}
                        </g>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        </>
      )}
      {refMode === 'list' && (
        <>
          <input style={S.input} value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Search..." />
          <div style={{ ...S.card, padding:0, overflow:'hidden', maxHeight:500, overflowY:'auto' }}>
            {filteredList.map((c,i) => (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom:i<filteredList.length-1?'1px solid #0d1235':'none', background:revealed.has(c.id)?'rgba(77,208,225,0.06)':i%2===0?'transparent':'#060b1a', cursor:'pointer' }}
                onClick={() => setRevealed(prev=>{const n=new Set(prev);n.has(c.id)?n.delete(c.id):n.add(c.id);return n})}>
                <div style={{ flex:1 }}>
                  <span style={{ fontSize:13, color: missCounts[c.id] > 0 ? '#ffb3b3' : '#c0c8e8' }}>{c.name}</span>
                  {missCounts[c.id] > 0 && <span style={{ display:'inline-flex', gap:2, marginLeft:4, verticalAlign:'middle' }}>{[0,1,2].map(i=><span key={i} style={{ width:6, height:6, borderRadius:'50%', background: i<missCounts[c.id]?'#e57373':'#1a2460', display:'inline-block' }}/>)}</span>}
                  {revealed.has(c.id) && <span style={{ fontSize:12, color:'#f5c518', marginLeft:10 }}>→ {c.capital}</span>}
                </div>
                <span style={{ fontSize:10, color:'#2a3460' }}>{revealed.has(c.id)?'▲':'▼'}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ display:'flex', gap:8 }}>
        <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11, color:'#4dd0e1' }} onClick={() => setRevealed(new Set(regionCountries.map(c=>c.id)))}>Show All</button>
        <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11 }} onClick={() => setRevealed(new Set())}>Hide All</button>
      </div>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 4px' }}>
        <button style={{ fontSize:12, color:'#4060a0', background:'none', border:'none', cursor:'pointer' }} onClick={onBack}>← Back</button>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button style={{ fontSize:11, color:'#4dd0e1', background:'none', border:'none', cursor:'pointer' }} onClick={() => setShowReference(true)}>📋 Reference</button>
          <div style={{ fontSize:11, color:'#4060a0', letterSpacing:2 }}>{score.correct}/{score.total} · {remaining} left</div>
          {remaining === 0 && Object.entries(attemptResults).some(([,r]) => !r.correct) && (
            <button style={{ fontSize:10, color:'#4caf7d', border:'1px solid #2e8c50', borderRadius:6, padding:'2px 8px', background:'#0a1e10', cursor:'pointer' }} onClick={() => {
              const missed = Object.entries(attemptResults).filter(([,r]) => !r.correct).map(([id, r]) => {
                const p = regionPaths.find(p => p.id === id)
                const img = p ? makeMapSnapshot(p, regionPaths) : null
                const card = makeFlashCard(img ? `[Map] ${r.country.name}` : r.country.name, `${r.country.name} · Capital: ${r.country.capital}`, `Geography · ${region.label}`)
                if (img) card.image = img
                return card
              })
              const freshCards = loadCards()
              const existing = new Set(freshCards.map(c => c.front))
              const newCards = missed.filter(c => !existing.has(c.front))
              if (newCards.length) {
                const updated = [...freshCards, ...newCards]
                try {
                  saveCards(updated)
                  setCards(updated)
                  alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck`)
                } catch {
                  const stripped = newCards.map(c => { const {image, ...rest} = c; return rest })
                  const updated2 = [...freshCards, ...stripped]
                  saveCards(updated2); setCards(updated2)
                  alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck (without map images - storage full)`)
                }
              } else { alert('No new cards to add') }
            }}>+ Add missed ({Object.entries(attemptResults).filter(([,r]) => !r.correct).length})</button>
          )}
        </div>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18 }} onClick={() => { const nz=Math.min(zoom*1.5,8); const cx=(480-pan.x)/zoom; const cy=(250-pan.y)/zoom; setPan({x:480-cx*nz,y:250-cy*nz}); setZoom(nz) }}>+</button>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18, opacity:zoom<=minZoom?0.3:1 }} disabled={zoom<=minZoom} onClick={() => { const nz=Math.max(zoom/1.5,minZoom); setZoom(nz); if(nz<=minZoom){setZoom(minZoom);setPan({x:0,y:0})} }}>−</button>
        <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:12 }} onClick={() => { setZoom(minZoom); setPan({x:0,y:0}) }}>Reset</button>
        <button style={{ ...S.btn, flex:1, padding:'6px 0', fontSize:12, background: autoNext ? 'rgba(245,197,24,0.15)' : undefined, border: autoNext ? '1px solid #f5c518' : undefined }} onClick={() => setAutoNext(a => !a)}>Auto Next {autoNext ? '✓' : '→'}</button>
      </div>
      <div
        style={{ width:'100%', background:'#060b1a', borderRadius:12, overflow:'hidden', border:'1px solid #1a2460', cursor:dragging?'grabbing':'grab', userSelect:'none' }}
        onMouseDown={e => { setDragging(true); setDragStart({x:e.clientX-pan.x,y:e.clientY-pan.y}) }}
        onMouseMove={e => { if(dragging&&dragStart) setPan({x:e.clientX-dragStart.x,y:e.clientY-dragStart.y}) }}
        onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}
        onTouchStart={e => { const t=e.touches[0]; setDragging(true); setDragStart({x:t.clientX-pan.x,y:t.clientY-pan.y}) }}
        onTouchMove={e => { if(dragging&&dragStart){const t=e.touches[0];setPan({x:t.clientX-dragStart.x,y:t.clientY-dragStart.y})} }}
        onTouchEnd={() => setDragging(false)}
      >
        {selected && TINY_ISLANDS.has(selected) && (
          <CaribbeanInset paths={regionPaths} selected={selected} attempted={attempted} attemptResults={attemptResults} />
        )}
        <svg viewBox="0 0 960 500" style={{ width:'100%', height:'auto', display:'block' }}>
          <rect width="960" height="500" fill="#060b1a" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {regionPaths.map(p => (
              <path key={p.id} d={p.d}
                fill={p.id===selected?'#f5c518':attempted.has(p.id)?'#e0e0e0':'#1a3070'}
                stroke="#0a0f2e" strokeWidth={0.5/zoom}
                onClick={e => { if(!dragging){e.stopPropagation();handleClick(p.id)} }}
                style={{ cursor:COUNTRY_MAP[p.id]&&!attempted.has(p.id)?'pointer':'default', transition:'fill 0.15s' }}
              />
            ))}
            {/* Permanent labels for attempted countries */}
            {regionPaths.map(p => {
              const res = attemptResults[p.id]
              const c = worldCentroids.current[p.id]
              if (!res || !c) return null
              return (
                <g key={`lbl-${p.id}`} style={{ pointerEvents:'none' }}>
                  <text x={c.x} y={c.y-4/zoom} textAnchor="middle" fontSize={7/zoom} fill={res.countryCorrect?'#4caf7d':'#e53935'} fontWeight="bold" fontFamily="sans-serif">{res.country.name}</text>
                  <text x={c.x} y={c.y+5/zoom} textAnchor="middle" fontSize={6/zoom} fill={res.capitalCorrect?'#4caf7d':'#e53935'} fontFamily="sans-serif">{res.country.capital}</text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      {selected && (
        <div style={S.card}>
          {result ? (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <span style={result.countryCorrect?S.correct:S.incorrect}>{result.countryCorrect?'✓':'✗'} Country: {result.country.name}</span>
                {!result.countryCorrect && <button style={{ fontSize:10, color:'#4caf7d', border:'1px solid #2e8c50', borderRadius:6, padding:'2px 8px', background:'#0a1e10', cursor:'pointer' }} onClick={() => markItemCorrect('country')}>Mark correct</button>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={result.capitalCorrect?S.correct:S.incorrect}>{result.capitalCorrect?'✓':'✗'} Capital: {result.country.capital}</span>
                {!result.capitalCorrect && <button style={{ fontSize:10, color:'#4caf7d', border:'1px solid #2e8c50', borderRadius:6, padding:'2px 8px', background:'#0a1e10', cursor:'pointer' }} onClick={() => markItemCorrect('capital')}>Mark correct</button>}
              </div>
              <button style={{ fontSize:10, color:'#4dd0e1', border:'1px solid #1a4060', borderRadius:6, padding:'3px 10px', background:'#0a1e20', cursor:'pointer', marginTop:6 }} onClick={() => {
                const country = COUNTRY_MAP[selected]
                if (!country) return
                const freshCards = loadCards()
                const p = regionPaths.find(p2 => p2.id === selected)
                const img = p ? makeMapSnapshot(p, regionPaths) : null
                const front = img ? `[Map] ${country.name}` : country.name
                if (freshCards.some(c => c.front === front)) { alert('Already in deck'); return }
                const card = makeFlashCard(front, `${country.name} · Capital: ${country.capital}`, `Geography · ${region.label}`)
                if (img) card.image = img
                const updated = [...freshCards, card]; saveCards(updated); setCards(updated)
                alert(`Added ${country.name} to deck`)
              }}>＋ Add to deck</button>
              <button style={{ ...S.btn, marginTop:12, fontSize:14 }} onClick={() => setSelected(null)}>TAP ANOTHER</button>
            </div>
          ) : (
            <div>
              <div style={S.subtitle}>IDENTIFY THIS COUNTRY</div>
              <input ref={inputRef} style={{ ...S.input, marginTop:8, marginBottom:8 }} value={answer.country} onChange={e => setAnswer(a=>({...a,country:e.target.value}))} placeholder="Country name..." />
              <input style={{ ...S.input, marginBottom:10 }} value={answer.capital} onChange={e => setAnswer(a=>({...a,capital:e.target.value}))} onKeyDown={e => { if(e.key==='Enter') checkAnswer() }} placeholder="Capital city..." />
              <button style={S.btn} onClick={() => checkAnswer()}>CHECK</button>
            </div>
          )}
        </div>
      )}
      {!selected && <div style={{ textAlign:'center', fontSize:12, color:'#2a3460', padding:'8px 0' }}>Tap any country on the map</div>}
    </div>
  )
}

// ─── Flash Drill Data ─────────────────────────────────────────────────────────

export const FLASH_DRILLS = {
  vice_presidents: {
    label: 'US VICE PRESIDENTS',
    emoji: '🏛',
    desc: 'All 49 VPs · number, name & president served under',
    modes: [
      { id: 'num_to_name', prompt: 'Number & President → VP Name', qField: 'prompt_num', aField: 'name' },
      { id: 'name_to_num', prompt: 'Name & President → Number', qField: 'prompt_name', aField: 'numStr' },
    ],
    items: [
      { num: 1, name: 'John Adams', president: 'Washington', years: '1789–1797' },
      { num: 2, name: 'Thomas Jefferson', president: 'Adams', years: '1797–1801' },
      { num: 3, name: 'Aaron Burr', president: 'Jefferson', years: '1801–1805' },
      { num: 4, name: 'George Clinton', president: 'Jefferson/Madison', years: '1805–1812' },
      { num: 5, name: 'Elbridge Gerry', president: 'Madison', years: '1813–1814' },
      { num: 6, name: 'Daniel D. Tompkins', president: 'Monroe', years: '1817–1825' },
      { num: 7, name: 'John C. Calhoun', president: 'Adams/Jackson', years: '1825–1832' },
      { num: 8, name: 'Martin Van Buren', president: 'Jackson', years: '1833–1837' },
      { num: 9, name: 'Richard Mentor Johnson', president: 'Van Buren', years: '1837–1841' },
      { num: 10, name: 'John Tyler', president: 'Harrison', years: '1841' },
      { num: 11, name: 'George M. Dallas', president: 'Polk', years: '1845–1849' },
      { num: 12, name: 'Millard Fillmore', president: 'Taylor', years: '1849–1850' },
      { num: 13, name: 'William Rufus DeVane King', president: 'Pierce', years: '1853' },
      { num: 14, name: 'John C. Breckinridge', president: 'Buchanan', years: '1857–1861' },
      { num: 15, name: 'Hannibal Hamlin', president: 'Lincoln', years: '1861–1865' },
      { num: 16, name: 'Andrew Johnson', president: 'Lincoln', years: '1865' },
      { num: 17, name: 'Schuyler Colfax', president: 'Grant', years: '1869–1873' },
      { num: 18, name: 'Henry Wilson', president: 'Grant', years: '1873–1875' },
      { num: 19, name: 'William A. Wheeler', president: 'Hayes', years: '1877–1881' },
      { num: 20, name: 'Chester A. Arthur', president: 'Garfield', years: '1881' },
      { num: 21, name: 'Thomas A. Hendricks', president: 'Cleveland', years: '1885' },
      { num: 22, name: 'Levi P. Morton', president: 'Harrison', years: '1889–1893' },
      { num: 23, name: 'Adlai Stevenson I', president: 'Cleveland', years: '1893–1897' },
      { num: 24, name: 'Garret Hobart', president: 'McKinley', years: '1897–1899' },
      { num: 25, name: 'Theodore Roosevelt', president: 'McKinley', years: '1901' },
      { num: 26, name: 'Charles W. Fairbanks', president: 'Roosevelt', years: '1905–1909' },
      { num: 27, name: 'James S. Sherman', president: 'Taft', years: '1909–1912' },
      { num: 28, name: 'Thomas R. Marshall', president: 'Wilson', years: '1913–1921' },
      { num: 29, name: 'Calvin Coolidge', president: 'Harding', years: '1921–1923' },
      { num: 30, name: 'Charles G. Dawes', president: 'Coolidge', years: '1925–1929' },
      { num: 31, name: 'Charles Curtis', president: 'Hoover', years: '1929–1933' },
      { num: 32, name: 'John Nance Garner', president: 'Roosevelt', years: '1933–1941' },
      { num: 33, name: 'Henry A. Wallace', president: 'Roosevelt', years: '1941–1945' },
      { num: 34, name: 'Harry S. Truman', president: 'Roosevelt', years: '1945' },
      { num: 35, name: 'Alben W. Barkley', president: 'Truman', years: '1949–1953' },
      { num: 36, name: 'Richard Nixon', president: 'Eisenhower', years: '1953–1961' },
      { num: 37, name: 'Lyndon B. Johnson', president: 'Kennedy', years: '1961–1963' },
      { num: 38, name: 'Hubert Humphrey', president: 'Johnson', years: '1965–1969' },
      { num: 39, name: 'Spiro Agnew', president: 'Nixon', years: '1969–1973' },
      { num: 40, name: 'Gerald Ford', president: 'Nixon', years: '1973–1974' },
      { num: 41, name: 'Nelson Rockefeller', president: 'Ford', years: '1974–1977' },
      { num: 42, name: 'Walter Mondale', president: 'Carter', years: '1977–1981' },
      { num: 43, name: 'George H.W. Bush', president: 'Reagan', years: '1981–1989' },
      { num: 44, name: 'Dan Quayle', president: 'Bush', years: '1989–1993' },
      { num: 45, name: 'Al Gore', president: 'Clinton', years: '1993–2001' },
      { num: 46, name: 'Dick Cheney', president: 'Bush', years: '2001–2009' },
      { num: 47, name: 'Joe Biden', president: 'Obama', years: '2009–2017' },
      { num: 48, name: 'Mike Pence', president: 'Trump', years: '2017–2021' },
      { num: 49, name: 'Kamala Harris', president: 'Biden', years: '2021–2025' },
    ].map(v => ({ ...v, numStr: String(v.num), prompt_num: `#${v.num} · Under ${v.president} · ${v.years}`, prompt_name: `${v.name} · ${v.years}` })),
  },

  astronomy: {
    label: 'PLANETS, MOONS & ASTRONOMY',
    emoji: '🪐',
    desc: 'Solar system, moons, stars & space facts',
    modes: [
      { id: 'qa', prompt: 'Question → Answer', qField: 'question', aField: 'answer' },
    ],
    items: [
      // Planets
      { question: 'Closest planet to the Sun', answer: 'Mercury' },
      { question: 'Hottest planet in the solar system', answer: 'Venus' },
      { question: 'Largest planet in the solar system', answer: 'Jupiter' },
      { question: 'Planet with the most moons', answer: 'Saturn (100+)' },
      { question: 'Planet known for its prominent ring system', answer: 'Saturn' },
      { question: 'Planet that rotates on its side', answer: 'Uranus' },
      { question: 'Farthest planet from the Sun', answer: 'Neptune' },
      { question: 'Smallest planet in the solar system', answer: 'Mercury' },
      { question: 'Planet with the Great Red Spot', answer: 'Jupiter' },
      { question: 'Planet with the Great Dark Spot (observed 1989)', answer: 'Neptune' },
      { question: 'Only planet not named after a Roman deity', answer: 'Earth' },
      { question: 'Planet with the shortest day (~10 hours)', answer: 'Jupiter' },
      { question: 'Planet with the longest year (~248 Earth years) — now dwarf', answer: 'Pluto' },
      { question: 'Planet with the longest day (~243 Earth days)', answer: 'Venus' },
      // Moons
      { question: "Earth's only natural satellite", answer: 'The Moon (Luna)' },
      { question: "Largest moon in the solar system", answer: "Ganymede (Jupiter's moon)" },
      { question: "Jupiter's moon with active volcanoes", answer: 'Io' },
      { question: "Jupiter's moon thought to have a subsurface ocean", answer: 'Europa' },
      { question: "Saturn's largest moon, with a thick atmosphere", answer: 'Titan' },
      { question: "Saturn's moon with geysers of water ice", answer: 'Enceladus' },
      { question: "Neptune's largest moon, orbits retrograde", answer: 'Triton' },
      { question: "Mars has two moons — name them", answer: 'Phobos and Deimos' },
      // Stars & space
      { question: 'Closest star to Earth (other than the Sun)', answer: 'Proxima Centauri' },
      { question: 'Largest known star by radius', answer: 'UY Scuti' },
      { question: 'Our galaxy\'s name', answer: 'The Milky Way' },
      { question: 'Nearest large galaxy to the Milky Way', answer: 'Andromeda (M31)' },
      { question: 'What is a light-year?', answer: 'Distance light travels in one year (~9.46 trillion km)' },
      { question: 'Year humans first landed on the Moon', answer: '1969 (Apollo 11)' },
      { question: 'First human in space', answer: 'Yuri Gagarin (1961)' },
      { question: 'Name of the force keeping planets in orbit', answer: 'Gravity' },
      { question: 'What is the asteroid belt?', answer: 'Region between Mars and Jupiter with many asteroids' },
      { question: 'What is a nebula?', answer: 'A cloud of gas and dust in space, often a stellar nursery' },
      { question: 'What causes a solar eclipse?', answer: 'The Moon passes between Earth and the Sun' },
      { question: 'What is the Kuiper Belt?', answer: 'Region beyond Neptune with icy bodies, including Pluto' },
      { question: 'Hubble Space Telescope launched in what year?', answer: '1990' },
      { question: 'Speed of light (approximate)', answer: '300,000 km/s (186,000 miles/s)' },
      // Space missions
      { question: 'First artificial satellite launched into orbit', answer: 'Sputnik 1 (USSR, 1957)' },
      { question: 'First American in space', answer: 'Alan Shepard (1961, Freedom 7)' },
      { question: 'First American to orbit Earth', answer: 'John Glenn (1962, Friendship 7)' },
      { question: 'Apollo 11 crew members', answer: 'Neil Armstrong, Buzz Aldrin, Michael Collins' },
      { question: 'First person to walk on the Moon', answer: 'Neil Armstrong (July 20, 1969)' },
      { question: 'Second person to walk on the Moon', answer: 'Buzz Aldrin (Apollo 11)' },
      { question: 'Last mission to land humans on the Moon', answer: 'Apollo 17 (December 1972)' },
      { question: 'Mission that famously said "Houston, we have a problem"', answer: 'Apollo 13 (1970)' },
      { question: 'Space Shuttle that broke apart on re-entry in 2003', answer: 'Columbia' },
      { question: 'Space Shuttle that exploded 73 seconds after launch in 1986', answer: 'Challenger' },
      { question: 'First space station (USSR, 1971)', answer: 'Salyut 1' },
      { question: 'International Space Station construction began in what year?', answer: '1998' },
      { question: 'First Mars rover (NASA, 1997)', answer: 'Sojourner (Mars Pathfinder mission)' },
      { question: 'Mars rover that discovered evidence of ancient water (2004)', answer: 'Opportunity (and Spirit)' },
      { question: 'Mars rover currently operating (as of 2021)', answer: 'Perseverance (and Curiosity)' },
      { question: 'Mission that took the first images of Pluto up close (2015)', answer: 'New Horizons' },
      { question: 'Voyager 1 launched in what year?', answer: '1977' },
      { question: 'What is Voyager 1 notable for?', answer: 'First human-made object to enter interstellar space' },
      { question: 'Space telescope that revealed deep field images of early universe', answer: 'James Webb Space Telescope (JWST)' },
      { question: 'Mission that proved gravitational waves exist (2015)', answer: 'LIGO (Laser Interferometer Gravitational-Wave Observatory)' },
      { question: 'First private company to send astronauts to the ISS', answer: 'SpaceX (Crew Dragon, 2020)' },
      { question: 'Mission that returned samples from the asteroid Ryugu', answer: 'Hayabusa2 (JAXA, Japan)' },
      { question: 'NASA mission that crashed a spacecraft into an asteroid to test deflection (2022)', answer: 'DART (Double Asteroid Redirection Test)' },
      { question: 'What is the Artemis program?', answer: "NASA's program to return humans to the Moon (2020s)" },
      { question: 'First woman in space', answer: 'Valentina Tereshkova (USSR, 1963)' },
      { question: 'First American woman in space', answer: 'Sally Ride (1983, STS-7)' },
      { question: 'Longest human spaceflight record holder (as of 2022)', answer: 'Oleg Kononenko (Russia, 878+ days cumulative)' },
      { question: 'Telescope used to first confirm exoplanets around sun-like stars', answer: 'Kepler Space Telescope' },
      { question: 'What was the Cassini mission?', answer: 'NASA spacecraft that orbited Saturn 2004–2017' },
      { question: 'What is the Event Horizon Telescope famous for?', answer: 'First image of a black hole (M87*, 2019)' },
    ],
  },

  shakespeare: {
    label: 'SHAKESPEARE',
    emoji: '🎭',
    desc: 'Plays, characters, quotes & categories',
    modes: [
      { id: 'char_to_play', prompt: 'Character → Play', qField: 'char_prompt', aField: 'play' },
      { id: 'play_to_type', prompt: 'Play → Type (Tragedy/Comedy/History)', qField: 'play', aField: 'type' },
      { id: 'quote_to_play', prompt: 'Quote → Play', qField: 'quote', aField: 'play' },
    ],
    items: [
      { play: 'Hamlet', type: 'Tragedy', characters: 'Hamlet, Ophelia, Polonius, Claudius', quote: 'To be, or not to be, that is the question', char_prompt: 'Ophelia, Polonius, Claudius' },
      { play: 'Macbeth', type: 'Tragedy', characters: 'Macbeth, Lady Macbeth, Banquo', quote: 'Out, damned spot!', char_prompt: 'Lady Macbeth, Banquo, the Three Witches' },
      { play: 'Romeo and Juliet', type: 'Tragedy', characters: 'Romeo, Juliet, Mercutio, Tybalt', quote: 'What\'s in a name? That which we call a rose by any other name would smell as sweet', char_prompt: 'Mercutio, Tybalt, Friar Lawrence' },
      { play: 'Othello', type: 'Tragedy', characters: 'Othello, Iago, Desdemona, Cassio', quote: 'O, beware, my lord, of jealousy! It is the green-eyed monster', char_prompt: 'Iago, Desdemona, Cassio' },
      { play: 'King Lear', type: 'Tragedy', characters: 'Lear, Cordelia, Goneril, Regan, Edmund', quote: 'How sharper than a serpent\'s tooth it is to have a thankless child', char_prompt: 'Cordelia, Goneril, Regan, the Fool' },
      { play: 'A Midsummer Night\'s Dream', type: 'Comedy', characters: 'Puck, Titania, Oberon, Bottom', quote: 'Lord, what fools these mortals be!', char_prompt: 'Puck, Titania, Oberon, Bottom' },
      { play: 'The Merchant of Venice', type: 'Comedy', characters: 'Shylock, Portia, Antonio, Bassanio', quote: 'If you prick us, do we not bleed?', char_prompt: 'Shylock, Portia, Antonio' },
      { play: 'Twelfth Night', type: 'Comedy', characters: 'Viola, Malvolio, Olivia, Sir Toby Belch', quote: 'If music be the food of love, play on', char_prompt: 'Viola, Malvolio, Sir Toby Belch' },
      { play: 'Much Ado About Nothing', type: 'Comedy', characters: 'Beatrice, Benedick, Don John', quote: 'Sigh no more, ladies, sigh no more', char_prompt: 'Beatrice, Benedick, Don John' },
      { play: 'The Tempest', type: 'Comedy', characters: 'Prospero, Caliban, Ariel, Miranda', quote: 'We are such stuff as dreams are made on', char_prompt: 'Prospero, Caliban, Ariel' },
      { play: 'As You Like It', type: 'Comedy', characters: 'Rosalind, Orlando, Jaques', quote: 'All the world\'s a stage', char_prompt: 'Rosalind, Orlando, Jaques' },
      { play: 'The Taming of the Shrew', type: 'Comedy', characters: 'Katherine, Petruchio', quote: 'I am ashamed that women are so simple', char_prompt: 'Katherine, Petruchio, Bianca' },
      { play: 'Richard III', type: 'History', characters: 'Richard III, Lady Anne, Buckingham', quote: 'A horse! A horse! My kingdom for a horse!', char_prompt: 'Richard III, Lady Anne, Buckingham' },
      { play: 'Henry V', type: 'History', characters: 'King Henry V, Falstaff', quote: 'Once more unto the breach, dear friends', char_prompt: 'King Henry V, Pistol, Fluellen' },
      { play: 'Julius Caesar', type: 'Tragedy', characters: 'Caesar, Brutus, Cassius, Mark Antony', quote: 'Et tu, Brute?', char_prompt: 'Brutus, Cassius, Mark Antony, Casca' },
      { play: 'Antony and Cleopatra', type: 'Tragedy', characters: 'Antony, Cleopatra, Octavius Caesar', quote: 'Age cannot wither her, nor custom stale her infinite variety', char_prompt: 'Cleopatra, Enobarbus, Octavius Caesar' },
      { play: 'The Winter\'s Tale', type: 'Comedy', characters: 'Leontes, Hermione, Perdita', quote: 'Exit, pursued by a bear', char_prompt: 'Leontes, Hermione, Perdita, Autolycus' },
      { play: 'Measure for Measure', type: 'Comedy', characters: 'Isabella, Angelo, Duke Vincentio', quote: 'The quality of mercy is not strained', char_prompt: 'Isabella, Angelo, Duke Vincentio' },
      { play: 'The Merry Wives of Windsor', type: 'Comedy', characters: 'Falstaff, Mistress Ford, Mistress Page', quote: "Why then the world's mine oyster", char_prompt: 'Falstaff, Mistress Ford, Mistress Page' },
      { play: "Love's Labour's Lost", type: 'Comedy', characters: 'Berowne, Rosaline, King Ferdinand', quote: "The world's a stage", char_prompt: 'Berowne, Rosaline, Don Armado' },
      { play: "All's Well That Ends Well", type: 'Comedy', characters: 'Helena, Bertram, Parolles', quote: "All's well that ends well", char_prompt: 'Helena, Bertram, Parolles' },
      { play: 'Coriolanus', type: 'Tragedy', characters: 'Coriolanus, Volumnia, Aufidius', quote: 'There is a world elsewhere', char_prompt: 'Coriolanus, Volumnia, Menenius' },
      { play: 'Troilus and Cressida', type: 'Tragedy', characters: 'Troilus, Cressida, Pandarus, Hector', quote: 'Time hath, my lord, a wallet at his back', char_prompt: 'Troilus, Cressida, Pandarus' },
      { play: 'Titus Andronicus', type: 'Tragedy', characters: 'Titus, Tamora, Aaron, Lavinia', quote: 'She is a woman, therefore may be wooed', char_prompt: 'Titus, Tamora, Aaron the Moor' },
      { play: 'Pericles', type: 'Comedy', characters: 'Pericles, Marina, Thaisa', quote: 'Few love to hear the sins they love to act', char_prompt: 'Pericles, Marina, Thaisa' },
      { play: 'Cymbeline', type: 'Comedy', characters: 'Imogen, Posthumus, Iachimo', quote: "Fear no more the heat o' the sun", char_prompt: 'Imogen, Posthumus, Iachimo' },
      { play: 'Henry IV Part 1', type: 'History', characters: 'Prince Hal, Falstaff, Hotspur', quote: 'The better part of valour is discretion', char_prompt: 'Prince Hal, Falstaff, Hotspur' },
      { play: 'Richard II', type: 'History', characters: 'Richard II, Bolingbroke, John of Gaunt', quote: 'This sceptred isle... this precious stone set in a silver sea', char_prompt: 'Richard II, Bolingbroke, John of Gaunt' },
      { play: 'Henry VI Part 1', type: 'History', characters: 'Henry VI, Joan of Arc, Talbot', quote: 'Defer no time, delays have dangerous ends', char_prompt: 'Henry VI, Joan of Arc, Talbot' },
    ],
  },

  authors: {
    label: 'FAMOUS AUTHORS & WORKS',
    emoji: '📚',
    desc: 'Authors, novels, plays & poems',
    modes: [
      { id: 'work_to_author', prompt: 'Title → Author', qField: 'work', aField: 'author' },
      { id: 'chars_to_title_author', prompt: 'Characters → Title & Author', qField: 'characters', aField: 'work_and_author', skipIfNoField: true },
    ],
    items: [
      { author: 'Jane Austen', work: 'Pride and Prejudice', characters: 'Elizabeth Bennet, Mr. Darcy, Jane Bennet, Mr. Wickham', author_prompt: 'Jane Austen (English novelist, early 19th c.)' },
      { author: 'Jane Austen', work: 'Sense and Sensibility', characters: 'Elinor Dashwood, Marianne Dashwood, Edward Ferrars, Colonel Brandon', author_prompt: 'Jane Austen (author of Emma)' },
      { author: 'Charles Dickens', work: 'A Tale of Two Cities', characters: 'Sydney Carton, Charles Darnay, Lucie Manette, Madame Defarge', author_prompt: 'Charles Dickens (Victorian era)' },
      { author: 'Charles Dickens', work: 'Great Expectations', characters: 'Pip, Miss Havisham, Estella, Abel Magwitch', author_prompt: 'Charles Dickens (Oliver Twist author)' },
      { author: 'Leo Tolstoy', work: 'War and Peace', characters: 'Pierre Bezukhov, Natasha Rostova, Andrei Bolkonsky, Napoleon', author_prompt: 'Leo Tolstoy (Russian, 19th c.)' },
      { author: 'Leo Tolstoy', work: 'Anna Karenina', characters: 'Anna Karenina, Count Vronsky, Levin, Kitty', author_prompt: 'Leo Tolstoy (War and Peace author)' },
      { author: 'Fyodor Dostoevsky', work: 'Crime and Punishment', characters: 'Raskolnikov, Sonia Marmeladova, Inspector Porfiry, Dunya', author_prompt: 'Fyodor Dostoevsky (Russian, 19th c.)' },
      { author: 'Fyodor Dostoevsky', work: 'The Brothers Karamazov', characters: 'Alyosha, Ivan, Dmitri, Father Zosima', author_prompt: 'Fyodor Dostoevsky (Crime and Punishment author)' },
      { author: 'Franz Kafka', work: 'The Metamorphosis', characters: 'Gregor Samsa, Grete Samsa', author_prompt: 'Franz Kafka (Czech-German, early 20th c.)' },
      { author: 'Franz Kafka', work: 'The Trial', author_prompt: 'Franz Kafka (The Metamorphosis author)' },
      { author: 'Gabriel García Márquez', work: 'One Hundred Years of Solitude', characters: 'José Arcadio Buendía, Úrsula Iguarán, Colonel Aureliano Buendía', author_prompt: 'Gabriel García Márquez (Colombian, magical realism)' },
      { author: 'James Joyce', work: 'Ulysses', characters: 'Leopold Bloom, Stephen Dedalus, Molly Bloom', author_prompt: 'James Joyce (Irish modernist)' },
      { author: 'James Joyce', work: 'Dubliners', author_prompt: 'James Joyce (Ulysses author)' },
      { author: 'Virginia Woolf', work: 'Mrs Dalloway', characters: 'Clarissa Dalloway, Septimus Warren Smith, Peter Walsh', author_prompt: 'Virginia Woolf (English modernist)' },
      { author: 'Virginia Woolf', work: 'To the Lighthouse', author_prompt: 'Virginia Woolf (Mrs Dalloway author)' },
      { author: 'Ernest Hemingway', work: 'The Old Man and the Sea', characters: 'Santiago, the Marlin', author_prompt: 'Ernest Hemingway (American, Nobel 1954)' },
      { author: 'Ernest Hemingway', work: 'A Farewell to Arms', characters: 'Frederic Henry, Catherine Barkley', author_prompt: 'Ernest Hemingway (The Sun Also Rises author)' },
      { author: 'William Faulkner', work: 'The Sound and the Fury', characters: 'Benjy, Quentin, Jason, Caddy Compson', author_prompt: 'William Faulkner (American South, Nobel 1949)' },
      { author: 'F. Scott Fitzgerald', work: 'The Great Gatsby', characters: 'Jay Gatsby, Nick Carraway, Daisy Buchanan, Tom Buchanan, Jordan Baker', author_prompt: 'F. Scott Fitzgerald (Jazz Age author)' },
      { author: 'John Steinbeck', work: 'The Grapes of Wrath', characters: 'Tom Joad, Ma Joad, Jim Casy, Rose of Sharon', author_prompt: 'John Steinbeck (Of Mice and Men author)' },
      { author: 'Toni Morrison', work: 'Beloved', characters: 'Sethe, Beloved, Paul D, Baby Suggs', author_prompt: 'Toni Morrison (American, Nobel 1993)' },
      { author: 'George Orwell', work: '1984', characters: "Winston Smith, Julia, O'Brien, Big Brother", author_prompt: 'George Orwell (dystopian fiction)' },
      { author: 'George Orwell', work: 'Animal Farm', characters: 'Napoleon, Snowball, Boxer, Old Major', author_prompt: 'George Orwell (1984 author)' },
      { author: 'Aldous Huxley', work: 'Brave New World', characters: 'Bernard Marx, John the Savage, Lenina Crowne, Mustapha Mond', author_prompt: 'Aldous Huxley (English, 20th c.)' },
      { author: 'Homer', work: 'The Iliad', characters: 'Achilles, Hector, Priam, Agamemnon, Odysseus, Patroclus', author_prompt: 'Homer (ancient Greek epic poet)' },
      { author: 'Homer', work: 'The Odyssey', characters: 'Odysseus, Penelope, Telemachus, Circe, Calypso, Polyphemus', author_prompt: 'Homer (The Iliad author)' },
      { author: 'Dante Alighieri', work: 'The Divine Comedy', author_prompt: 'Dante Alighieri (Italian, medieval)' },
      { author: 'Miguel de Cervantes', work: 'Don Quixote', characters: 'Don Quixote, Sancho Panza, Dulcinea del Toboso', author_prompt: 'Miguel de Cervantes (Spanish, 17th c.)' },
      { author: 'Victor Hugo', work: 'Les Misérables', characters: 'Jean Valjean, Javert, Fantine, Cosette, Marius, Éponine, Thénardier', author_prompt: 'Victor Hugo (French, 19th c.)' },
      { author: 'Victor Hugo', work: 'The Hunchback of Notre-Dame', characters: 'Quasimodo, Esmeralda, Frollo, Phoebus', author_prompt: 'Victor Hugo (Les Misérables author)' },
      { author: 'Gustave Flaubert', work: 'Madame Bovary', characters: 'Emma Bovary, Charles Bovary, Rodolphe, Léon', author_prompt: 'Gustave Flaubert (French realist)' },
      { author: 'Marcel Proust', work: 'In Search of Lost Time', author_prompt: 'Marcel Proust (French, early 20th c.)' },
      { author: 'Albert Camus', work: 'The Stranger', characters: 'Meursault, Marie, Raymond', author_prompt: 'Albert Camus (French-Algerian, Nobel 1957)' },
      { author: 'Jean-Paul Sartre', work: 'Nausea', author_prompt: 'Jean-Paul Sartre (French existentialist)' },
      { author: 'Samuel Beckett', work: 'Waiting for Godot', characters: 'Vladimir, Estragon, Pozzo, Lucky, Godot', author_prompt: 'Samuel Beckett (Irish, Nobel 1969)' },
      { author: 'Chinua Achebe', work: 'Things Fall Apart', characters: 'Okonkwo, Nwoye, Ezinma, Mr. Brown', author_prompt: 'Chinua Achebe (Nigerian)' },
      { author: 'Haruki Murakami', work: 'Norwegian Wood', characters: 'Toru Watanabe, Naoko, Midori', author_prompt: 'Haruki Murakami (Japanese contemporary)' },
      { author: 'Fyodor Dostoevsky', work: 'The Idiot', author_prompt: 'Fyodor Dostoevsky (Notes from Underground author)' },
      { author: 'John Milton', work: 'Paradise Lost', characters: 'Satan, Adam, Eve, God, Raphael, Michael', author_prompt: 'John Milton (English, 17th c. epic poet)' },
      { author: 'Geoffrey Chaucer', work: 'The Canterbury Tales', characters: "the Knight, the Miller, the Wife of Bath, the Pardoner", author_prompt: 'Geoffrey Chaucer (Middle English poet)' },
      { author: 'William Blake', work: 'Songs of Innocence and of Experience', author_prompt: 'William Blake (English Romantic poet)' },
      { author: 'Edgar Allan Poe', work: 'The Tell-Tale Heart', characters: 'The Narrator, the Old Man', author_prompt: 'Edgar Allan Poe (American Gothic)' },
      { author: 'Edgar Allan Poe', work: 'The Raven', author_prompt: 'Edgar Allan Poe (The Tell-Tale Heart author)' },
      { author: 'Mark Twain', work: 'Adventures of Huckleberry Finn', characters: "Huck Finn, Jim, Tom Sawyer, the Duke, the King", author_prompt: 'Mark Twain (American humorist)' },
      { author: 'Herman Melville', work: 'Moby-Dick', characters: 'Ishmael, Captain Ahab, Queequeg, the White Whale', author_prompt: 'Herman Melville (American, 19th c.)' },
      { author: 'Nathaniel Hawthorne', work: 'The Scarlet Letter', characters: 'Hester Prynne, Arthur Dimmesdale, Roger Chillingworth, Pearl', author_prompt: 'Nathaniel Hawthorne (American Puritan era)' },
      { author: 'Henry David Thoreau', work: 'Walden', characters: 'Henry David Thoreau (narrator)', author_prompt: 'Henry David Thoreau (American Transcendentalist)' },
      { author: 'Walt Whitman', work: 'Leaves of Grass', author_prompt: 'Walt Whitman (American poet, free verse)' },
      { author: 'Emily Dickinson', work: 'Because I Could Not Stop for Death', author_prompt: 'Emily Dickinson (American reclusive poet)' },
      { author: 'Oscar Wilde', work: 'The Picture of Dorian Gray', characters: 'Dorian Gray, Lord Henry Wotton, Basil Hallward, Sibyl Vane', author_prompt: 'Oscar Wilde (Irish wit, late Victorian)' },
      { author: 'Oscar Wilde', work: 'The Importance of Being Earnest', author_prompt: 'Oscar Wilde (The Picture of Dorian Gray author)' },
      { author: 'Thomas Hardy', work: "Tess of the d'Urbervilles", author_prompt: 'Thomas Hardy (English Victorian)' },
      { author: 'Joseph Conrad', work: 'Heart of Darkness', characters: 'Marlow, Kurtz', author_prompt: 'Joseph Conrad (Polish-British modernist)' },
      { author: 'D.H. Lawrence', work: "Lady Chatterley's Lover", author_prompt: "D.H. Lawrence (Sons and Lovers author)" },
      { author: 'T.S. Eliot', work: 'The Waste Land', author_prompt: 'T.S. Eliot (American-British poet, Nobel 1948)' },
      { author: 'William Butler Yeats', work: 'The Second Coming', author_prompt: 'W.B. Yeats (Irish poet, Nobel 1923)' },
      { author: 'Boris Pasternak', work: 'Doctor Zhivago', characters: 'Yuri Zhivago, Lara, Tonya', author_prompt: 'Boris Pasternak (Russian, Nobel 1958)' },
      { author: 'Alexander Solzhenitsyn', work: 'One Day in the Life of Ivan Denisovich', author_prompt: 'Solzhenitsyn (Russian dissident, Nobel 1970)' },
      { author: 'Gabriel García Márquez', work: 'Love in the Time of Cholera', author_prompt: 'García Márquez (One Hundred Years of Solitude author)' },
      { author: 'Isabel Allende', work: 'The House of the Spirits', characters: 'Esteban Trueba, Clara del Valle, Blanca, Alba', author_prompt: 'Isabel Allende (Chilean magical realism)' },
      { author: 'Jorge Luis Borges', work: 'Ficciones', author_prompt: 'Jorge Luis Borges (Argentine, short stories)' },
      { author: 'Umberto Eco', work: 'The Name of the Rose', characters: 'Brother William of Baskerville, Adso, Jorge of Burgos', author_prompt: 'Umberto Eco (Italian semiotician)' },
      { author: 'Italo Calvino', work: "If on a Winter's Night a Traveler", author_prompt: "Italo Calvino (Italian postmodernist)" },
      { author: 'Naguib Mahfouz', work: 'The Cairo Trilogy', author_prompt: 'Naguib Mahfouz (Egyptian, Nobel 1988)' },
      { author: 'Kenzaburō Ōe', work: 'A Personal Matter', author_prompt: 'Kenzaburō Ōe (Japanese, Nobel 1994)' },
      { author: 'Yasunari Kawabata', work: 'Snow Country', author_prompt: 'Yasunari Kawabata (Japanese, Nobel 1968)' },
      { author: 'Doris Lessing', work: 'The Golden Notebook', author_prompt: 'Doris Lessing (British-Zimbabwean, Nobel 2007)' },
      { author: 'Kazuo Ishiguro', work: 'The Remains of the Day', characters: 'Stevens, Miss Kenton, Lord Darlington', author_prompt: 'Kazuo Ishiguro (British-Japanese, Nobel 2017)' },
      { author: 'Salman Rushdie', work: "Midnight's Children", characters: "Saleem Sinai, Shiva, Parvati-the-Witch", author_prompt: 'Salman Rushdie (British-Indian)' },
    ],
  },

  painters: {
    label: 'FAMOUS PAINTERS & WORKS',
    emoji: '🎨',
    desc: 'Artists, paintings & movements',
    modes: [
      { id: 'work_to_artist', prompt: 'Painting Title → Artist', qField: 'work', aField: 'artist' },
      { id: 'image_to_both', prompt: 'Image → Work Title & Artist', qField: 'image', aField: 'work_and_artist' },
    ],
    items: [
      { artist: 'Leonardo da Vinci', work: 'Mona Lisa', image: '/paintings/mona_lisa.jpg', movement: 'Renaissance', artist_prompt: 'Leonardo da Vinci (Italian Renaissance)' },
      { artist: 'Leonardo da Vinci', work: 'The Last Supper', image: '/paintings/the_last_supper.jpg', movement: 'Renaissance', artist_prompt: 'Leonardo da Vinci (Mona Lisa painter)' },
      { artist: 'Michelangelo', work: 'The Creation of Adam', image: '/paintings/creation_of_adam.jpg', movement: 'Renaissance', artist_prompt: 'Michelangelo (Sistine Chapel ceiling)' },
      { artist: 'Raphael', work: 'The School of Athens', image: '/paintings/school_of_athens.jpg', movement: 'Renaissance', artist_prompt: 'Raphael (Italian High Renaissance)' },
      { artist: 'Sandro Botticelli', work: 'The Birth of Venus', image: '/paintings/birth_of_venus.jpg', movement: 'Renaissance', artist_prompt: 'Sandro Botticelli (Italian Renaissance)' },
      { artist: 'Rembrandt', work: 'The Night Watch', image: '/paintings/the_night_watch.jpg', movement: 'Dutch Golden Age', artist_prompt: 'Rembrandt van Rijn (Dutch master)' },
      { artist: 'Johannes Vermeer', work: 'Girl with a Pearl Earring', image: '/paintings/girl_pearl_earring.jpg', movement: 'Dutch Golden Age', artist_prompt: 'Johannes Vermeer (Dutch, 17th c.)' },
      { artist: 'Francisco Goya', work: 'The Third of May 1808', image: '/paintings/third_of_may.jpg', movement: 'Romanticism', artist_prompt: 'Francisco Goya (Spanish, late 18th c.)' },
      { artist: 'Eugène Delacroix', work: 'Liberty Leading the People', image: '/paintings/liberty_leading.jpg', movement: 'Romanticism', artist_prompt: 'Eugène Delacroix (French Romantic)' },
      { artist: 'J.M.W. Turner', work: 'The Fighting Temeraire', image: '/paintings/fighting_temeraire.jpg', movement: 'Romanticism', artist_prompt: 'J.M.W. Turner (English landscape painter)' },
      { artist: 'Claude Monet', work: 'Water Lilies', image: '/paintings/water_lilies.jpg', movement: 'Impressionism', artist_prompt: 'Claude Monet (French Impressionist)' },
      { artist: 'Claude Monet', work: 'Impression, Sunrise', image: '/paintings/impression_sunrise.jpg', movement: 'Impressionism', artist_prompt: 'Claude Monet (Water Lilies painter)' },
      { artist: 'Pierre-Auguste Renoir', work: 'Luncheon of the Boating Party', image: '/paintings/luncheon_boating.jpg', movement: 'Impressionism', artist_prompt: 'Pierre-Auguste Renoir (French Impressionist)' },
      { artist: 'Edgar Degas', work: 'The Dance Class', image: '/paintings/dance_class.jpg', movement: 'Impressionism', artist_prompt: 'Edgar Degas (French, ballet paintings)' },
      { artist: 'Georges Seurat', work: 'A Sunday on La Grande Jatte', image: '/paintings/sunday_grande_jatte.jpg', movement: 'Post-Impressionism', artist_prompt: 'Georges Seurat (Pointillism founder)' },
      { artist: 'Paul Cézanne', work: 'The Card Players', image: '/paintings/card_players.jpg', movement: 'Post-Impressionism', artist_prompt: 'Paul Cézanne (father of modern art)' },
      { artist: 'Paul Gauguin', work: 'Where Do We Come From?', image: '/paintings/where_do_we_come_from.jpg', movement: 'Post-Impressionism', artist_prompt: 'Paul Gauguin (Tahitian paintings)' },
      { artist: 'Vincent van Gogh', work: 'The Starry Night', image: '/paintings/starry_night.jpg', movement: 'Post-Impressionism', artist_prompt: 'Vincent van Gogh (Dutch Post-Impressionist)' },
      { artist: 'Vincent van Gogh', work: 'Sunflowers', image: '/paintings/sunflowers.jpg', movement: 'Post-Impressionism', artist_prompt: 'Vincent van Gogh (The Starry Night painter)' },
      { artist: 'Edvard Munch', work: 'The Scream', image: '/paintings/the_scream.jpg', movement: 'Expressionism', artist_prompt: 'Edvard Munch (Norwegian Expressionist)' },
      { artist: 'Gustav Klimt', work: 'The Kiss', image: '/paintings/the_kiss.jpg', movement: 'Symbolism', artist_prompt: 'Gustav Klimt (Austrian, golden style)' },
      { artist: 'Pablo Picasso', work: 'Guernica', image: '/paintings/guernica.jpg', movement: 'Cubism', artist_prompt: 'Pablo Picasso (Spanish, co-founder of Cubism)' },
      { artist: 'Pablo Picasso', work: 'Les Demoiselles d\'Avignon', image: '/paintings/les_demoiselles.jpg', movement: 'Cubism', artist_prompt: 'Pablo Picasso (Guernica painter)' },
      { artist: 'Henri Matisse', work: 'Dance', image: '/paintings/dance_matisse.jpg', movement: 'Fauvism', artist_prompt: 'Henri Matisse (French, bold color)' },
      { artist: 'Salvador Dalí', work: 'The Persistence of Memory', image: '/paintings/persistence_of_memory.jpg', movement: 'Surrealism', artist_prompt: 'Salvador Dalí (Spanish Surrealist)' },
      { artist: 'René Magritte', work: 'The Treachery of Images', image: '/paintings/treachery_of_images.jpg', movement: 'Surrealism', artist_prompt: 'René Magritte (Belgian Surrealist, pipe painting)' },
      { artist: 'Frida Kahlo', work: 'The Two Fridas', image: '/paintings/two_fridas.jpg', movement: 'Surrealism', artist_prompt: 'Frida Kahlo (Mexican, self-portraits)' },
      { artist: 'Jackson Pollock', work: 'No. 31', image: '/paintings/no_31.jpg', movement: 'Abstract Expressionism', artist_prompt: 'Jackson Pollock (drip painting technique)' },
      { artist: 'Mark Rothko', work: 'Orange and Yellow', image: '/paintings/orange_yellow.jpg', movement: 'Abstract Expressionism', artist_prompt: 'Mark Rothko (color field painting)' },
      { artist: 'Andy Warhol', work: 'Campbell\'s Soup Cans', image: '/paintings/campbell_soup.jpg', movement: 'Pop Art', artist_prompt: 'Andy Warhol (American Pop Art)' },
      { artist: 'Roy Lichtenstein', work: 'Whaam!', image: '/paintings/whaam.jpg', movement: 'Pop Art', artist_prompt: 'Roy Lichtenstein (comic-style Pop Art)' },
      { artist: 'Grant Wood', work: 'American Gothic', image: '/paintings/american_gothic.jpg', movement: 'Regionalism', artist_prompt: 'Grant Wood (American Regionalism)' },
      { artist: 'Edward Hopper', work: 'Nighthawks', image: '/paintings/nighthawks.jpg', movement: 'Realism', artist_prompt: 'Edward Hopper (American Realist)' },
      { artist: 'Jan van Eyck', work: 'The Arnolfini Portrait', image: '/paintings/arnolfini_portrait.jpg', movement: 'Northern Renaissance', artist_prompt: 'Jan van Eyck (Flemish, early Northern Renaissance)' },
      { artist: 'Hieronymus Bosch', work: 'The Garden of Earthly Delights', image: '/paintings/garden_earthly_delights.jpg', movement: 'Northern Renaissance', artist_prompt: 'Hieronymus Bosch (Dutch, fantastical imagery)' },
      { artist: 'Pieter Bruegel the Elder', work: 'The Hunters in the Snow', image: '/paintings/hunters_in_snow.jpg', movement: 'Northern Renaissance', artist_prompt: 'Bruegel the Elder (Flemish, peasant scenes)' },
      { artist: 'Albrecht Dürer', work: 'Self-Portrait at 28', image: '/paintings/durer_self_portrait.jpg', movement: 'Northern Renaissance', artist_prompt: 'Albrecht Dürer (German Renaissance printmaker)' },
      { artist: 'Peter Paul Rubens', work: 'The Descent from the Cross', image: '/paintings/descent_from_cross.jpg', movement: 'Baroque', artist_prompt: 'Peter Paul Rubens (Flemish Baroque)' },
      { artist: 'Diego Velázquez', work: 'Las Meninas', image: '/paintings/las_meninas.jpg', movement: 'Baroque', artist_prompt: 'Diego Velázquez (Spanish Baroque court painter)' },
      { artist: 'Caravaggio', work: 'The Calling of Saint Matthew', image: '/paintings/calling_saint_matthew.jpg', movement: 'Baroque', artist_prompt: 'Caravaggio (Italian, dramatic chiaroscuro)' },
      { artist: 'Jacques-Louis David', work: 'The Death of Marat', image: '/paintings/death_of_marat.jpg', movement: 'Neoclassicism', artist_prompt: 'Jacques-Louis David (French Neoclassicist)' },
      { artist: 'Caspar David Friedrich', work: 'Wanderer above the Sea of Fog', image: '/paintings/wanderer_sea_fog.jpg', movement: 'Romanticism', artist_prompt: 'Caspar David Friedrich (German Romantic)' },
      { artist: 'Winslow Homer', work: 'The Gulf Stream', image: '/paintings/gulf_stream.jpg', movement: 'Realism', artist_prompt: 'Winslow Homer (American Realist)' },
      { artist: 'Thomas Eakins', work: 'The Gross Clinic', image: '/paintings/gross_clinic.jpg', movement: 'Realism', artist_prompt: 'Thomas Eakins (American Realist)' },
      { artist: 'Berthe Morisot', work: 'The Cradle', image: '/paintings/the_cradle.jpg', movement: 'Impressionism', artist_prompt: 'Berthe Morisot (French Impressionist, first woman)' },
      { artist: 'Mary Cassatt', work: "The Child's Bath", image: '/paintings/childs_bath.jpg', movement: 'Impressionism', artist_prompt: 'Mary Cassatt (American Impressionist)' },
      { artist: 'Egon Schiele', work: 'Self-Portrait with Physalis', image: '/paintings/egon_schiele.jpg', movement: 'Expressionism', artist_prompt: 'Egon Schiele (Austrian Expressionist)' },
      { artist: 'Wassily Kandinsky', work: 'Composition VIII', image: '/paintings/composition_viii.jpg', movement: 'Abstract', artist_prompt: 'Wassily Kandinsky (pioneer of abstract art)' },
      { artist: 'Piet Mondrian', work: 'Broadway Boogie Woogie', image: '/paintings/broadway_boogie.jpg', movement: 'De Stijl', artist_prompt: 'Piet Mondrian (Dutch, grid paintings)' },
      { artist: "Georgia O'Keeffe", work: 'Jimson Weed/White Flower No. 1', image: '/paintings/jimson_weed.jpg', movement: 'Modernism', artist_prompt: "Georgia O'Keeffe (American, flower & desert)" },
      { artist: 'Diego Rivera', work: 'Man at the Crossroads', image: '/paintings/man_at_crossroads.jpg', movement: 'Social Realism', artist_prompt: 'Diego Rivera (Mexican muralist)' },
      { artist: 'René Magritte', work: 'The Son of Man', image: '/paintings/son_of_man.jpg', movement: 'Surrealism', artist_prompt: 'René Magritte (apple-in-front-of-face painting)' },
      { artist: 'Jean-Michel Basquiat', work: 'Untitled (Skull)', image: '/paintings/basquiat_skull.jpg', movement: 'Neo-Expressionism', artist_prompt: 'Jean-Michel Basquiat (American, 1980s Neo-Exp.)' },
      { artist: 'Banksy', work: 'Girl with Balloon', image: '/paintings/girl_balloon.jpg', movement: 'Street Art', artist_prompt: 'Banksy (anonymous British street artist)' },
    ],
  },

  composers: {
    label: 'CLASSICAL COMPOSERS',
    emoji: '🎼',
    desc: 'Composers, works & eras',
    modes: [
      { id: 'work_to_composer', prompt: 'Work → Composer', qField: 'work', aField: 'composer' },
      { id: 'composer_to_era', prompt: 'Composer → Era', qField: 'composer_prompt', aField: 'era' },
    ],
    items: [
      { composer: 'Johann Sebastian Bach', work: 'Brandenburg Concertos', era: 'Baroque', composer_prompt: 'J.S. Bach (German Baroque)' },
      { composer: 'Johann Sebastian Bach', work: 'Mass in B Minor', era: 'Baroque', composer_prompt: 'J.S. Bach (Toccata and Fugue composer)' },
      { composer: 'George Frideric Handel', work: 'Messiah', era: 'Baroque', composer_prompt: 'Handel (German-British Baroque)' },
      { composer: 'Antonio Vivaldi', work: 'The Four Seasons', era: 'Baroque', composer_prompt: 'Vivaldi (Italian Baroque)' },
      { composer: 'Franz Joseph Haydn', work: 'The Creation', era: 'Classical', composer_prompt: 'Haydn (father of the symphony)' },
      { composer: 'Wolfgang Amadeus Mozart', work: 'Symphony No. 40', era: 'Classical', composer_prompt: 'Mozart (child prodigy, Classical era)' },
      { composer: 'Wolfgang Amadeus Mozart', work: 'Don Giovanni', era: 'Classical', composer_prompt: 'Mozart (The Magic Flute composer)' },
      { composer: 'Wolfgang Amadeus Mozart', work: 'Requiem', era: 'Classical', composer_prompt: 'Mozart (Symphony No. 40 composer)' },
      { composer: 'Ludwig van Beethoven', work: 'Symphony No. 9', era: 'Classical/Romantic', composer_prompt: 'Beethoven (deaf composer, German)' },
      { composer: 'Ludwig van Beethoven', work: 'Moonlight Sonata', era: 'Classical/Romantic', composer_prompt: 'Beethoven (Symphony No. 5 composer)' },
      { composer: 'Ludwig van Beethoven', work: 'Für Elise', era: 'Classical/Romantic', composer_prompt: 'Beethoven (Ode to Joy composer)' },
      { composer: 'Franz Schubert', work: 'Symphony No. 8 "Unfinished"', era: 'Romantic', composer_prompt: 'Schubert (Austrian Romantic)' },
      { composer: 'Frédéric Chopin', work: 'Nocturnes', era: 'Romantic', composer_prompt: 'Chopin (Polish Romantic, piano works)' },
      { composer: 'Robert Schumann', work: 'Piano Concerto in A minor', era: 'Romantic', composer_prompt: 'Robert Schumann (German Romantic)' },
      { composer: 'Felix Mendelssohn', work: 'A Midsummer Night\'s Dream', era: 'Romantic', composer_prompt: 'Mendelssohn (German Romantic)' },
      { composer: 'Johannes Brahms', work: 'Symphony No. 4', era: 'Romantic', composer_prompt: 'Brahms (German, late Romantic)' },
      { composer: 'Richard Wagner', work: 'The Ring Cycle', era: 'Romantic', composer_prompt: 'Wagner (German opera composer)' },
      { composer: 'Richard Wagner', work: 'Tristan und Isolde', era: 'Romantic', composer_prompt: 'Wagner (The Ride of the Valkyries)' },
      { composer: 'Giuseppe Verdi', work: 'La Traviata', era: 'Romantic', composer_prompt: 'Verdi (Italian opera, 19th c.)' },
      { composer: 'Giuseppe Verdi', work: 'Aida', era: 'Romantic', composer_prompt: 'Verdi (Rigoletto, La Traviata composer)' },
      { composer: 'Giacomo Puccini', work: 'La Bohème', era: 'Late Romantic', composer_prompt: 'Puccini (Italian opera, verismo)' },
      { composer: 'Giacomo Puccini', work: 'Madama Butterfly', era: 'Late Romantic', composer_prompt: 'Puccini (La Bohème composer)' },
      { composer: 'Pyotr Ilyich Tchaikovsky', work: 'Swan Lake', era: 'Romantic', composer_prompt: 'Tchaikovsky (Russian Romantic)' },
      { composer: 'Pyotr Ilyich Tchaikovsky', work: '1812 Overture', era: 'Romantic', composer_prompt: 'Tchaikovsky (Swan Lake composer)' },
      { composer: 'Antonín Dvořák', work: 'Symphony No. 9 "From the New World"', era: 'Romantic', composer_prompt: 'Dvořák (Czech Romantic)' },
      { composer: 'Claude Debussy', work: 'Clair de Lune', era: 'Impressionist', composer_prompt: 'Debussy (French Impressionist)' },
      { composer: 'Maurice Ravel', work: 'Bolero', era: 'Impressionist', composer_prompt: 'Ravel (French, early 20th c.)' },
      { composer: 'Igor Stravinsky', work: 'The Rite of Spring', era: 'Modern', composer_prompt: 'Stravinsky (Russian-American, modernist)' },
      { composer: 'Sergei Rachmaninoff', work: 'Piano Concerto No. 2', era: 'Late Romantic', composer_prompt: 'Rachmaninoff (Russian Romantic)' },
      { composer: 'Dmitri Shostakovich', work: 'Symphony No. 5', era: 'Modern', composer_prompt: 'Shostakovich (Soviet-era Russian)' },
      { composer: 'Aaron Copland', work: 'Appalachian Spring', era: 'Modern', composer_prompt: 'Copland (American, 20th c.)' },
      { composer: 'George Gershwin', work: 'Rhapsody in Blue', era: 'Modern', composer_prompt: 'Gershwin (American, jazz-classical fusion)' },
      { composer: 'Béla Bartók', work: 'Concerto for Orchestra', era: 'Modern', composer_prompt: 'Bartók (Hungarian, folk-influenced)' },
      { composer: 'Sergei Prokofiev', work: 'Peter and the Wolf', era: 'Modern', composer_prompt: 'Prokofiev (Russian, early 20th c.)' },
      { composer: 'Sergei Prokofiev', work: 'Symphony No. 1 "Classical"', era: 'Modern', composer_prompt: 'Prokofiev (Romeo and Juliet composer)' },
      { composer: 'Benjamin Britten', work: 'Peter Grimes', era: 'Modern', composer_prompt: 'Britten (English, 20th c. opera)' },
      { composer: 'Philip Glass', work: 'Einstein on the Beach', era: 'Minimalist', composer_prompt: 'Philip Glass (American minimalist)' },
      { composer: 'John Adams', work: 'Nixon in China', era: 'Minimalist', composer_prompt: 'John Adams (American minimalist opera)' },
      { composer: 'Edvard Grieg', work: 'Peer Gynt Suite', era: 'Romantic', composer_prompt: 'Edvard Grieg (Norwegian Romantic)' },
      { composer: 'Jean Sibelius', work: 'Finlandia', era: 'Romantic', composer_prompt: 'Sibelius (Finnish Romantic)' },
      { composer: 'Camille Saint-Saëns', work: 'The Carnival of the Animals', era: 'Romantic', composer_prompt: 'Saint-Saëns (French, late Romantic)' },
      { composer: 'Camille Saint-Saëns', work: 'Danse Macabre', era: 'Romantic', composer_prompt: 'Saint-Saëns (The Carnival of the Animals composer)' },
      { composer: 'Gabriel Fauré', work: 'Requiem', era: 'Romantic', composer_prompt: 'Gabriel Fauré (French, late Romantic)' },
      { composer: 'Erik Satie', work: 'Gymnopédies', era: 'Impressionist', composer_prompt: 'Erik Satie (French, early 20th c.)' },
      { composer: 'Francis Poulenc', work: 'Dialogues of the Carmelites', era: 'Modern', composer_prompt: 'Francis Poulenc (French, 20th c. opera)' },
      { composer: 'Carl Orff', work: 'Carmina Burana', era: 'Modern', composer_prompt: 'Carl Orff (German, 20th c.)' },
      { composer: 'Arvo Pärt', work: 'Spiegel im Spiegel', era: 'Minimalist', composer_prompt: 'Arvo Pärt (Estonian, tintinnabuli style)' },
      { composer: 'Hildegard von Bingen', work: 'Ordo Virtutum', era: 'Medieval', composer_prompt: 'Hildegard von Bingen (12th c. abbess, composer)' },
      { composer: 'Claudio Monteverdi', work: "L'Orfeo", era: 'Baroque', composer_prompt: 'Monteverdi (Italian, first major opera, 1607)' },
      { composer: 'Henry Purcell', work: 'Dido and Aeneas', era: 'Baroque', composer_prompt: 'Henry Purcell (English Baroque opera)' },
    ],
  },

  ballets: {
    label: 'FAMOUS BALLETS',
    emoji: '🩰',
    desc: 'Ballets, composers & major characters',
    modes: [
      { id: 'ballet_to_composer', prompt: 'Title → Composer', qField: 'ballet', aField: 'composer' },
      { id: 'chars_to_title_composer', prompt: 'Characters → Title & Composer', qField: 'characters', aField: 'ballet_and_composer' },
    ],
    items: [
      { ballet: 'Swan Lake', composer: 'Tchaikovsky', characters: 'Odette/Odile, Prince Siegfried, Rothbart', composer_prompt: 'Tchaikovsky (most famous ballet)' },
      { ballet: 'The Sleeping Beauty', composer: 'Tchaikovsky', characters: 'Aurora, Prince Désiré, Carabosse, Lilac Fairy', composer_prompt: 'Tchaikovsky (Aurora is the princess)' },
      { ballet: 'The Nutcracker', composer: 'Tchaikovsky', characters: 'Clara, the Nutcracker Prince, Sugar Plum Fairy', composer_prompt: 'Tchaikovsky (Christmas classic)' },
      { ballet: 'Giselle', composer: 'Adolphe Adam', characters: 'Giselle, Albrecht, Hilarion, Myrtha', composer_prompt: 'Adolphe Adam (Romantic era ballet)' },
      { ballet: 'Coppélia', composer: 'Léo Delibes', characters: 'Swanilda, Franz, Dr. Coppélius', composer_prompt: 'Léo Delibes (comic ballet)' },
      { ballet: 'La Bayadère', composer: 'Ludwig Minkus', characters: 'Nikiya, Solor, Gamzatti', composer_prompt: 'Ludwig Minkus (Indian temple setting)' },
      { ballet: 'Don Quixote', composer: 'Ludwig Minkus', characters: 'Kitri, Basilio, Don Quixote, Sancho Panza', composer_prompt: 'Ludwig Minkus (Spanish setting)' },
      { ballet: 'Romeo and Juliet', composer: 'Sergei Prokofiev', characters: 'Romeo, Juliet, Mercutio, Tybalt', composer_prompt: 'Prokofiev (Shakespeare adaptation)' },
      { ballet: 'Cinderella', composer: 'Sergei Prokofiev', characters: 'Cinderella, the Prince, Stepsisters', composer_prompt: 'Prokofiev (fairy tale ballet)' },
      { ballet: 'The Firebird', composer: 'Igor Stravinsky', characters: 'The Firebird, Ivan Tsarevich, Koschei', composer_prompt: 'Stravinsky (first major ballet, 1910)' },
      { ballet: 'Petrushka', composer: 'Igor Stravinsky', characters: 'Petrushka, the Ballerina, the Moor', composer_prompt: 'Stravinsky (Russian puppet ballet)' },
      { ballet: 'The Rite of Spring', composer: 'Igor Stravinsky', characters: 'The Chosen One, Elders, Maidens', composer_prompt: 'Stravinsky (caused riot at premiere, 1913)' },
      { ballet: 'Les Sylphides', composer: 'Frédéric Chopin (orch. various)', characters: 'A Poet, Sylphides (no narrative)', composer_prompt: 'Chopin / Fokine (plotless Romantic ballet)' },
      { ballet: 'Spartacus', composer: 'Aram Khachaturian', characters: 'Spartacus, Phrygia, Crassus, Aegina', composer_prompt: 'Khachaturian (Bolshoi classic)' },
      { ballet: 'La Sylphide', composer: 'Jean Madeleine Schneitzhoeffer', characters: 'James, the Sylph, Madge, Effie', composer_prompt: 'Schneitzhoeffer (first Romantic ballet, 1832)' },
      { ballet: 'Sleeping Beauty', composer: 'Tchaikovsky', characters: 'Princess Aurora, Prince Désiré, Carabosse, Lilac Fairy', composer_prompt: 'Tchaikovsky (Aurora is the princess, premiered 1890)' },
      { ballet: 'Jewels', composer: 'Gabriel Fauré / Igor Stravinsky / Pyotr Tchaikovsky', characters: 'Three abstract sections: Emeralds, Rubies, Diamonds', composer_prompt: 'Balanchine / Fauré-Stravinsky-Tchaikovsky (plotless triptych)' },
      { ballet: 'Manon', composer: 'Jules Massenet (arr. Leighton Lucas)', characters: 'Manon, Des Grieux, Lescaut', composer_prompt: 'MacMillan / Massenet (Royal Ballet classic)' },
      { ballet: 'Onegin', composer: 'Pyotr Tchaikovsky (arr. Kurt-Heinz Stolze)', characters: 'Tatiana, Onegin, Lensky, Olga', composer_prompt: 'Cranko / Tchaikovsky (based on Pushkin poem)' },
      { ballet: 'Mayerling', composer: 'Franz Liszt (arr. John Lanchbery)', characters: 'Crown Prince Rudolf, Mary Vetsera', composer_prompt: 'MacMillan / Liszt (Habsburg tragedy)' },
      { ballet: 'La Fille Mal Gardée', composer: 'Ferdinand Hérold', characters: 'Lise, Colas, Widow Simone', composer_prompt: 'Hérold / Ashton (comic ballet, 1960 Royal Ballet)' },
      { ballet: 'Apollo', composer: 'Igor Stravinsky', characters: 'Apollo, Calliope, Polyhymnia, Terpsichore', composer_prompt: 'Balanchine / Stravinsky (neoclassical, 1928)' },
      { ballet: 'Serenade', composer: 'Pyotr Tchaikovsky', characters: 'Abstract (no narrative)', composer_prompt: 'Balanchine / Tchaikovsky (first Balanchine ballet in America)' },
      { ballet: 'The Corsaire', composer: 'Adolphe Adam', characters: 'Conrad, Medora, Ali', composer_prompt: 'Adam / Perrot (19th c. Romantic, pirate theme)' },
      { ballet: 'Le Corsaire pas de deux', composer: 'Ludwig Minkus', characters: 'The Slave (Ali), Medora', composer_prompt: 'Minkus (popular competition piece)' },
      { ballet: 'Notre-Dame de Paris', composer: 'Maurice Jarre', characters: 'Quasimodo, Esmeralda, Frollo, Phoebus', composer_prompt: 'Petit / Jarre (based on Victor Hugo)' },
      { ballet: 'Anna Karenina', composer: 'Pyotr Tchaikovsky (arr. various)', characters: 'Anna, Vronsky, Karenin', composer_prompt: 'Various choreographers / Tchaikovsky (based on Tolstoy)' },
    ],
  },

  greek_latin_roots: {
    label: 'GREEK & LATIN ROOTS',
    emoji: '📜',
    desc: 'Roots, meanings & example words',
    modes: [
      { id: 'root_to_meaning', prompt: 'Root → Meaning', qField: 'root_prompt', aField: 'meaning' },
      { id: 'meaning_to_root', prompt: 'Meaning → Root', qField: 'meaning', aField: 'root' },
    ],
    items: [
      { root: 'aqua', origin: 'Latin', meaning: 'water', examples: 'aquatic, aquarium, aqueduct', root_prompt: 'aqua- (Latin)' },
      { root: 'bio', origin: 'Greek', meaning: 'life', examples: 'biology, biography, antibiotic', root_prompt: 'bio- (Greek)' },
      { root: 'chron', origin: 'Greek', meaning: 'time', examples: 'chronology, synchronize, anachronism', root_prompt: 'chron- (Greek)' },
      { root: 'dem', origin: 'Greek', meaning: 'people', examples: 'democracy, epidemic, demographic', root_prompt: 'dem- (Greek)' },
      { root: 'dict', origin: 'Latin', meaning: 'say/speak', examples: 'dictate, predict, contradict', root_prompt: 'dict- (Latin)' },
      { root: 'duc/duct', origin: 'Latin', meaning: 'lead', examples: 'conduct, produce, introduce', root_prompt: 'duc/duct- (Latin)' },
      { root: 'geo', origin: 'Greek', meaning: 'earth', examples: 'geography, geology, geometry', root_prompt: 'geo- (Greek)' },
      { root: 'graph/gram', origin: 'Greek', meaning: 'write/draw', examples: 'biography, telegram, autograph', root_prompt: 'graph/gram- (Greek)' },
      { root: 'hydr', origin: 'Greek', meaning: 'water', examples: 'hydrogen, hydraulic, dehydrate', root_prompt: 'hydr- (Greek)' },
      { root: 'log', origin: 'Greek', meaning: 'word/study/reason', examples: 'biology, logic, dialogue', root_prompt: 'log- (Greek)' },
      { root: 'luc/lum', origin: 'Latin', meaning: 'light', examples: 'illuminate, lucid, translucent', root_prompt: 'luc/lum- (Latin)' },
      { root: 'magna/magni', origin: 'Latin', meaning: 'great/large', examples: 'magnificent, magnify, magnitude', root_prompt: 'magna/magni- (Latin)' },
      { root: 'mal', origin: 'Latin', meaning: 'bad/evil', examples: 'malicious, malfunction, malady', root_prompt: 'mal- (Latin)' },
      { root: 'man/manu', origin: 'Latin', meaning: 'hand', examples: 'manual, manufacture, manuscript', root_prompt: 'man/manu- (Latin)' },
      { root: 'min', origin: 'Latin', meaning: 'small', examples: 'minimum, miniature, minute', root_prompt: 'min- (Latin)' },
      { root: 'mit/miss', origin: 'Latin', meaning: 'send', examples: 'transmit, mission, dismiss', root_prompt: 'mit/miss- (Latin)' },
      { root: 'mort', origin: 'Latin', meaning: 'death', examples: 'mortal, immortal, mortify', root_prompt: 'mort- (Latin)' },
      { root: 'omni', origin: 'Latin', meaning: 'all', examples: 'omnipotent, omnivore, omniscient', root_prompt: 'omni- (Latin)' },
      { root: 'path', origin: 'Greek', meaning: 'feeling/disease', examples: 'empathy, pathology, sympathy', root_prompt: 'path- (Greek)' },
      { root: 'phil', origin: 'Greek', meaning: 'love', examples: 'philosophy, philanthropist, bibliophile', root_prompt: 'phil- (Greek)' },
      { root: 'phon', origin: 'Greek', meaning: 'sound', examples: 'telephone, microphone, symphony', root_prompt: 'phon- (Greek)' },
      { root: 'photo', origin: 'Greek', meaning: 'light', examples: 'photograph, photosynthesis, photon', root_prompt: 'photo- (Greek)' },
      { root: 'poly', origin: 'Greek', meaning: 'many', examples: 'polygon, polyglot, polygamy', root_prompt: 'poly- (Greek)' },
      { root: 'port', origin: 'Latin', meaning: 'carry', examples: 'transport, portable, export', root_prompt: 'port- (Latin)' },
      { root: 'psych', origin: 'Greek', meaning: 'mind/soul', examples: 'psychology, psychiatry, psychic', root_prompt: 'psych- (Greek)' },
      { root: 'rupt', origin: 'Latin', meaning: 'break', examples: 'rupture, interrupt, disrupt', root_prompt: 'rupt- (Latin)' },
      { root: 'scrib/script', origin: 'Latin', meaning: 'write', examples: 'describe, manuscript, prescription', root_prompt: 'scrib/script- (Latin)' },
      { root: 'sens/sent', origin: 'Latin', meaning: 'feel', examples: 'sensitive, consent, sentence', root_prompt: 'sens/sent- (Latin)' },
      { root: 'sol', origin: 'Latin', meaning: 'sun/alone', examples: 'solar, solitary, soliloquy', root_prompt: 'sol- (Latin)' },
      { root: 'spec/spect', origin: 'Latin', meaning: 'look/see', examples: 'spectacle, inspect, perspective', root_prompt: 'spec/spect- (Latin)' },
      { root: 'struct', origin: 'Latin', meaning: 'build', examples: 'construct, structure, destroy', root_prompt: 'struct- (Latin)' },
      { root: 'tele', origin: 'Greek', meaning: 'far/distant', examples: 'telephone, telescope, television', root_prompt: 'tele- (Greek)' },
      { root: 'terra', origin: 'Latin', meaning: 'earth/land', examples: 'territory, terrain, terrestrial', root_prompt: 'terra- (Latin)' },
      { root: 'therm', origin: 'Greek', meaning: 'heat', examples: 'thermometer, thermal, thermostat', root_prompt: 'therm- (Greek)' },
      { root: 'trans', origin: 'Latin', meaning: 'across/beyond', examples: 'transport, transform, transit', root_prompt: 'trans- (Latin)' },
      { root: 'ven/vent', origin: 'Latin', meaning: 'come', examples: 'convene, event, adventure', root_prompt: 'ven/vent- (Latin)' },
      { root: 'vid/vis', origin: 'Latin', meaning: 'see', examples: 'vision, video, evident', root_prompt: 'vid/vis- (Latin)' },
      { root: 'vit/viv', origin: 'Latin', meaning: 'life/live', examples: 'vital, vivid, revive', root_prompt: 'vit/viv- (Latin)' },
      { root: 'voc/vok', origin: 'Latin', meaning: 'voice/call', examples: 'vocal, invoke, vocabulary', root_prompt: 'voc/vok- (Latin)' },
      { root: 'zoo', origin: 'Greek', meaning: 'animal', examples: 'zoology, zoo, protozoa', root_prompt: 'zoo- (Greek)' },
      { root: 'anthrop', origin: 'Greek', meaning: 'human', examples: 'anthropology, philanthropy, misanthrope', root_prompt: 'anthrop- (Greek)' },
      { root: 'arch', origin: 'Greek', meaning: 'rule/chief/ancient', examples: 'monarchy, anarchy, archaeology', root_prompt: 'arch- (Greek)' },
      { root: 'cred', origin: 'Latin', meaning: 'believe', examples: 'credible, credit, incredible', root_prompt: 'cred- (Latin)' },
      { root: 'culp', origin: 'Latin', meaning: 'blame/fault', examples: 'culprit, culpable, exculpate', root_prompt: 'culp- (Latin)' },
      { root: 'cycl', origin: 'Greek', meaning: 'circle/wheel', examples: 'bicycle, cycle, encyclopedia', root_prompt: 'cycl- (Greek)' },
    ],
  },
}

// ─── Flash Drill Component ────────────────────────────────────────────────────
function FlashDrill({ drillKey, onBack, cards = [], setCards = () => {} }) {
  const drill = FLASH_DRILLS[drillKey]
  const [mode, setMode] = useState('setup')
  const [selectedMode, setSelectedMode] = useState(drill.modes[0].id)
  const [order, setOrder] = useState('sequential')
  const [showReference, setShowReference] = useState(false)
  const [queue, setQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const [results, setResults] = useState([])
  const [revealed, setRevealed] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const inputRef = useRef(null)

  const modeConfig = drill.modes.find(m => m.id === selectedMode) || drill.modes[0]

  function startQuiz() {
    const allItems = modeConfig.qField === 'image' ? drill.items.filter(it => it.image) : modeConfig.skipIfNoField ? drill.items.filter(it => it[modeConfig.qField]) : drill.items
    const q = order === 'sequential' ? [...allItems] : [...allItems].sort(() => Math.random() - 0.5)
    setQueue(q)
    setIdx(0)
    setResults([])
    setAnswer('')
    setRevealed(false)
    setMode('quiz')
  }

  const [answer2, setAnswer2] = useState('') // second answer field for image_to_both
  const [missCounts, setMissCounts] = useState(() => getDrillMissCounts(drillKey))

  function checkAnswer(override = false) {
    const item = queue[idx]
    const userAns = override ? '(marked correct)' : answer.trim()
    let correct, expected

    if (modeConfig.aField === 'work_and_artist') {
      const workCorrect = override || fuzzyMatch(userAns, item.work || '')
      const artistCorrect = override || fuzzyMatch(answer2.trim(), item.artist || '')
      correct = workCorrect && artistCorrect
      expected = `${item.work} · ${item.artist}`
    } else if (modeConfig.aField === 'ballet_and_composer') {
      const titleCorrect = override || fuzzyMatch(userAns, item.ballet || '')
      const composerCorrect = override || fuzzyMatch(answer2.trim(), item.composer || '')
      correct = titleCorrect && composerCorrect
      expected = `${item.ballet} · ${item.composer}`
    } else if (modeConfig.aField === 'work_and_author') {
      const titleCorrect = override || fuzzyMatch(userAns, item.work || '')
      const authorCorrect = override || fuzzyMatch(answer2.trim(), item.author || '')
      correct = titleCorrect && authorCorrect
      expected = `${item.work} · ${item.author}`
    } else {
      correct = override || fuzzyMatch(userAns, String(item[modeConfig.aField] || ''))
      expected = item[modeConfig.aField]
    }

    setResults(prev => [...prev, { item, userAnswer: userAns, correct, expected }])
    setRevealed(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function markCorrect() {
    setResults(prev => { const u = [...prev]; u[u.length-1] = { ...u[u.length-1], correct: true }; return u })
  }

  function next() {
    if (idx + 1 >= queue.length) {
      saveDrillSession(drillKey, results.filter(r => r.correct).length, queue.length)
      saveDrillMisses(drillKey, results.filter(r => !r.correct).map(r => String(r.item[modeConfig.qField])))
      setMissCounts(getDrillMissCounts(drillKey))
      setMode('results')
    } else {
      setIdx(i => i + 1)
      setAnswer('')
      setAnswer2('')
      setRevealed(false)
    }
  }

  const item = queue[idx]
  const score = results.filter(r => r.correct).length
  const filteredItems = drill.items.filter(it =>
    !listSearch ||
    Object.values(it).some(v => String(v).toLowerCase().includes(listSearch.toLowerCase()))
  )

  if (showReference) return (
    <div style={S.wrap}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
        <button style={{ fontSize:12, color:'#4060a0', background:'none', border:'none', cursor:'pointer' }} onClick={() => setShowReference(false)}>← Back</button>
        <div style={S.title}>{drill.emoji} {drill.label}</div>
      </div>
      <input style={S.input} value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Search..." />
      <div style={{ ...S.card, padding:0, overflow:'hidden', maxHeight:600, overflowY:'auto' }}>
        {filteredItems.map((it, i) => {
          const missKey = String(it[modeConfig.qField])
          const missCount = missCounts[missKey] || 0
          return (
            <div key={i} style={{ padding:'8px 14px', borderBottom:i<filteredItems.length-1?'1px solid #0d1235':'none', background:missCount>0?'rgba(229,115,115,0.06)':i%2===0?'transparent':'#060b1a', display:'flex', gap:10 }}>
              {it.image && (
                <img src={it.image} alt={it.work} referrerPolicy="no-referrer" style={{ width:64, height:64, objectFit:'contain', borderRadius:6, flexShrink:0, background:'#060b1a' }} onError={e => { e.target.style.display='none' }} />
              )}
              <div style={{ flex:1 }}>
                {missCount > 0 && (
                  <div style={{ display:'flex', gap:2, marginBottom:4 }}>
                    {[0,1,2].map(j => <div key={j} style={{ width:6, height:6, borderRadius:'50%', background:j<missCount?'#e57373':'#1a2460' }} />)}
                  </div>
                )}
                {Object.entries(it)
                  .filter(([k]) => !k.includes('_prompt') && !k.includes('numStr') && k !== 'image')
                  .map(([k, v]) => (
                    <div key={k} style={{ display:'flex', gap:8, fontSize:12, marginBottom:2 }}>
                      <span style={{ color:'#4060a0', minWidth:80, fontSize:10, letterSpacing:1 }}>{k.toUpperCase()}</span>
                      <span style={{ color:missCount>0?'#ffb3b3':'#c0c8e8' }}>{String(v)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  if (mode === 'setup') return (
    <div style={S.wrap}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
        <button style={{ fontSize:12, color:'#4060a0', background:'none', border:'none', cursor:'pointer' }} onClick={onBack}>← Back</button>
        <div style={S.title}>{drill.emoji} {drill.label}</div>
      </div>
      <div style={S.card}>
        <div style={{ fontSize:10, color:'#4060a0', letterSpacing:2, marginBottom:8 }}>MODE</div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
          {drill.modes.map(m => (
            <button key={m.id} onClick={() => setSelectedMode(m.id)} style={{ padding:'8px 12px', borderRadius:8, border:`1px solid ${selectedMode===m.id?'#f5c518':'#1a2460'}`, background:selectedMode===m.id?'rgba(245,197,24,0.1)':'#060b1a', color:selectedMode===m.id?'#f5c518':'#6070a0', cursor:'pointer', fontSize:12, textAlign:'left' }}>{m.prompt}</button>
          ))}
        </div>
        <div style={{ fontSize:10, color:'#4060a0', letterSpacing:2, marginBottom:8 }}>ORDER</div>
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          {[['sequential','In Order'],['random','Random']].map(([v,l]) => (
            <button key={v} onClick={() => setOrder(v)} style={{ flex:1, padding:'8px 0', borderRadius:8, border:`1px solid ${order===v?'#f5c518':'#1a2460'}`, background:order===v?'rgba(245,197,24,0.1)':'#060b1a', color:order===v?'#f5c518':'#6070a0', cursor:'pointer', fontSize:13 }}>{l}</button>
          ))}
        </div>
        <button style={S.btn} onClick={startQuiz}>START QUIZ</button>
      </div>
      <button style={{ ...S.btnSecondary, color:'#4dd0e1', borderColor:'#1a4060' }} onClick={() => setShowReference(true)}>📋 View Reference List</button>
    </div>
  )

  if (mode === 'results') return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.title}>RESULTS</div>
        <div style={S.scoreBox}>
          <div style={S.bigNum}>{score}/{queue.length}</div>
          <div style={{ fontSize:13, color:score/queue.length>=0.9?'#4caf7d':score/queue.length>=0.7?'#f5c518':'#e57373' }}>
            {score/queue.length>=0.9?'Excellent!':score/queue.length>=0.7?'Good work':score/queue.length>=0.5?'Keep practicing':'Needs work'}
          </div>
        </div>
        <div style={{ maxHeight:300, overflowY:'auto' }}>
          {results.filter(r => !r.correct).map((r, i) => (
            <div key={i} style={{ borderBottom:'1px solid #1a2040', padding:'6px 0', fontSize:11 }}>
              <div style={{ color:'#4060a0', fontSize:10 }}>{r.item[modeConfig.qField]}</div>
              <span style={{ color:'#e57373' }}>✗ {r.userAnswer || '(blank)'}</span>
              <span style={{ color:'#4caf7d', marginLeft:8 }}>→ {r.expected}</span>
            </div>
          ))}
        </div>
      </div>
      {results.some(r => !r.correct) && (
        <button style={{ ...S.btnSecondary, color: '#4caf7d', borderColor: '#2e8c50' }} onClick={() => {
          const missed = results.filter(r => !r.correct).map(r => {
            const front = r.item[modeConfig.qField] === r.item.image
              ? `[Image] ${r.item.work || r.item[modeConfig.qField]}`
              : String(r.item[modeConfig.qField])
            const back = String(r.expected || r.item[modeConfig.aField] || '')
            return makeFlashCard(front, back, drill.label)
          })
          const freshCards = loadCards()
          const existing = new Set(freshCards.map(c => c.front))
          const newCards = missed.filter(c => !existing.has(c.front))
          if (newCards.length) {
            const updated = [...freshCards, ...newCards]
            saveCards(updated); setCards(updated)
            alert(`Added ${newCards.length} card${newCards.length !== 1 ? 's' : ''} to your deck${missed.length - newCards.length > 0 ? ` (${missed.length - newCards.length} already existed)` : ''}`)
          } else { alert('All missed items already in your deck') }
        }}>+ Add missed to deck ({results.filter(r => !r.correct).length})</button>
      )}
      <button style={S.btn} onClick={() => setMode('setup')}>Try Again</button>
      <button style={S.btnSecondary} onClick={onBack}>← Back</button>
    </div>
  )

  // Quiz mode
  return (
    <div style={S.wrap}>
      <div style={S.progress}>{idx+1} / {queue.length} · {score} correct</div>
      <div style={S.card}>
        <div style={{ fontSize:10, color:'#4060a0', letterSpacing:2, marginBottom:8 }}>{modeConfig.prompt.toUpperCase()}</div>
        {/* Image mode: show image as the question */}
        {modeConfig.qField === 'image' && item.image ? (
          <img
            src={item.image}
            alt="Identify this artwork"
            referrerPolicy="no-referrer"
            style={{ width:'100%', maxHeight:220, objectFit:'contain', borderRadius:8, marginBottom:12, background:'#0a0f2e' }}
            onError={e => { e.target.style.display='none' }}
          />
        ) : (
          <div style={{ fontSize:15, color:'#c0c8e8', lineHeight:1.5, marginBottom:12 }}>{item[modeConfig.qField]}</div>
        )}
        {/* Show image after reveal for non-image modes */}
        {modeConfig.qField !== 'image' && item.image && revealed && (
          <img
            src={item.image}
            alt={item.work}
            referrerPolicy="no-referrer"
            style={{ width:'100%', maxHeight:160, objectFit:'contain', borderRadius:8, marginBottom:10, background:'#060b1a' }}
            onError={e => { e.target.style.display='none' }}
          />
        )}
        <input
          ref={inputRef}
          autoFocus
          style={{ ...S.input, borderColor:revealed?(results[results.length-1]?.correct?'#4caf7d':'#e57373'):'#1a2460' }}
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={e => { if(e.key==='Enter' && !revealed) { if(modeConfig.aField === 'work_and_artist' && !answer2) return; checkAnswer() } else if(e.key==='Enter' && revealed) next() }}
          placeholder={modeConfig.aField === 'work_and_artist' ? 'Work title...' : modeConfig.aField === 'ballet_and_composer' ? 'Ballet title...' : modeConfig.aField === 'work_and_author' ? 'Novel/work title...' : 'Your answer...'}
          readOnly={revealed}
        />
        {(modeConfig.aField === 'work_and_artist' || modeConfig.aField === 'ballet_and_composer' || modeConfig.aField === 'work_and_author') && (
          <input
            style={{ ...S.input, marginTop:8, borderColor:revealed?(results[results.length-1]?.correct?'#4caf7d':'#e57373'):'#1a2460' }}
            value={answer2}
            onChange={e => setAnswer2(e.target.value)}
            onKeyDown={e => { if(e.key==='Enter') revealed?next():checkAnswer() }}
            placeholder={modeConfig.aField === 'ballet_and_composer' ? 'Composer name...' : modeConfig.aField === 'work_and_author' ? 'Author name...' : 'Artist name...'}
            readOnly={revealed}
          />
        )}
        {revealed && (
          <div style={{ marginTop:8 }}>
            {results[results.length-1]?.correct
              ? <span style={S.correct}>✓ Correct!</span>
              : (
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <div>
                    {modeConfig.aField === 'work_and_artist'
                      ? <><span style={S.incorrect}>✗ {item.work}</span><span style={{ color:'#6070a0', margin:'0 6px' }}>by</span><span style={S.incorrect}>{item.artist}</span></>
                      : modeConfig.aField === 'ballet_and_composer'
                      ? <><span style={S.incorrect}>✗ {item.ballet}</span><span style={{ color:'#6070a0', margin:'0 6px' }}>by</span><span style={S.incorrect}>{item.composer}</span></>
                      : modeConfig.aField === 'work_and_author'
                      ? <><span style={S.incorrect}>✗ {item.work}</span><span style={{ color:'#6070a0', margin:'0 6px' }}>by</span><span style={S.incorrect}>{item.author}</span></>
                      : <span style={S.incorrect}>✗ {item[modeConfig.aField]}</span>
                    }
                  </div>
                  <button style={{ fontSize:10, color:'#4caf7d', border:'1px solid #2e8c50', borderRadius:6, padding:'2px 8px', background:'#0a1e10', cursor:'pointer' }} onClick={markCorrect}>Mark correct</button>
                </div>
              )}
          </div>
        )}
      </div>
      {!revealed
        ? <button style={S.btn} onClick={() => checkAnswer()}>CHECK</button>
        : <button style={S.btn} onClick={next}>{idx+1>=queue.length?'SEE RESULTS':'NEXT →'}</button>}
      <button style={{ ...S.btnSecondary, fontSize:10, padding:'4px 0', color:'#4caf7d', borderColor:'#2e8c50' }} onClick={() => {
        const front = modeConfig.qField === 'image' ? `[Map] ${item.work || item[modeConfig.qField]}` : String(item[modeConfig.qField])
        const back = String(item[modeConfig.aField] || item.work_and_artist || '')
        const freshCards = loadCards()
        if (freshCards.some(c => c.front === front)) { alert('Already in deck'); return }
        const card = makeFlashCard(front, back, drill.label)
        const updated = [...freshCards, card]
        saveCards(updated); setCards(updated)
        alert('Added to deck')
      }}>＋ Add this card to deck</button>
      <button style={S.btnSecondary} onClick={() => setMode('setup')}>← Setup</button>
    </div>
  )
}
