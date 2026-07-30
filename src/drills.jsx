import { useState, useEffect, useRef } from 'react'

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
  // Allow up to 2 edits for strings longer than 5 chars, 1 edit for shorter
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
  stats[drillId] = stats[drillId].slice(0, 20) // keep last 20
  localStorage.setItem(DRILL_STATS_KEY, JSON.stringify(stats))
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
export function PresidentsDrill({ onBack }) {
  const [mode, setMode] = useState('setup') // setup | quiz | results
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
              <div style={{ fontSize: 13, color: '#c0c8e8' }}>{p.name}</div>
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
          disabled={revealed}
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
        ? <button style={S.btn} onClick={checkAnswer}>CHECK</button>
        : <button style={S.btn} onClick={next}>{idx + 1 >= queue.length ? 'SEE RESULTS' : 'NEXT →'}</button>}
    </div>
  )
}

// ─── Labeled Map Reference ───────────────────────────────────────────────────
function LabeledMapReference({ onBack, paths, pathCentroids }) {
  const [refMode, setRefMode] = useState('map') // map | list
  const [revealed, setRevealed] = useState(new Set())
  const [zoom, setZoom] = useState(1)
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
            <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => setZoom(z => Math.min(z * 1.5, 8))}>+</button>
            <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => { setZoom(z => Math.max(z / 1.5, 1)); setPan({ x: 0, y: 0 }) }}>−</button>
            <button style={{ ...S.btnSecondary, flex: 1, padding: '6px 0', fontSize: 12 }} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Reset View</button>
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
                  if (!country || !centroid || zoom < 1.5) return null
                  const isRevealed = revealed.has(p.id)
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
                  <span style={{ fontSize: 13, color: '#c0c8e8' }}>{c.name}</span>
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
export function WorldMapDrill({ onBack, preloadedPaths, preloadedCentroids }) {
  const [geoData, setGeoData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [answer, setAnswer] = useState({ country: '', capital: '' })
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [attempted, setAttempted] = useState(new Set())
  const [mode, setMode] = useState('map')
  const [showReference, setShowReference] = useState(false)
  const inputRef = useRef(null)
  const svgRef = useRef(null)
  const [paths, setPaths] = useState([])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const pathCentroids = useRef({}) // id → {x, y} center

  useEffect(() => {
    if (preloadedPaths?.length > 0) {
      setPaths(preloadedPaths)
      if (preloadedCentroids) pathCentroids.current = preloadedCentroids.current
      setLoading(false)
      return
    }
    fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
      .then(r => r.json())
      .then(data => {
        setGeoData(data)
        setLoading(false)
        buildPaths(data)
      })
      .catch(() => setLoading(false))
  }, [preloadedPaths])

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
      // Average of outer ring points
      const ring = coords[0]
      const xs = ring.map(p => project(p)[0])
      const ys = ring.map(p => project(p)[1])
      return { x: xs.reduce((a,b) => a+b,0)/xs.length, y: ys.reduce((a,b) => a+b,0)/ys.length }
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
    setScore(prev => ({ correct: prev.correct + (bothCorrect ? 1 : 0), total: prev.total + 1 }))
  }

  function markItemCorrect(field) {
    if (!result) return
    const updated = { ...result, [field + 'Correct']: true }
    setResult(updated)
    if (updated.countryCorrect && updated.capitalCorrect) {
      setScore(prev => ({ ...prev, correct: prev.correct + 1 }))
    }
  }

  function getColor(id) {
    if (id === selected) return '#f5c518'
    if (attempted.has(id)) {
      const country = COUNTRY_MAP[id]
      if (!country) return '#1a2460'
      return '#4caf7d'
    }
    return '#1a3070'
  }

  const totalKnown = COUNTRIES.length
  const remaining = totalKnown - attempted.size

  if (showReference) return (
    <LabeledMapReference onBack={() => setShowReference(false)} paths={paths} pathCentroids={pathCentroids} />
  )

  if (loading) return (
    <div style={{ ...S.wrap, alignItems: 'center', padding: 40 }}>
      <div style={{ color: '#4060a0', fontSize: 13 }}>Loading world map...</div>
    </div>
  )

  if (!geoData) return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={{ color: '#e57373', fontSize: 13 }}>Failed to load map. Check your connection.</div>
      </div>
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
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => setZoom(z => Math.min(z * 1.5, 8))}>+</button>
        <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => { setZoom(z => Math.max(z / 1.5, 1)); setPan({ x: 0, y: 0 }) }}>−</button>
        <button style={{ ...S.btnSecondary, flex: 1, padding: '6px 0', fontSize: 12 }} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Reset View</button>
        <button style={{ ...S.btn, flex: 1, padding: '6px 0', fontSize: 12 }} onClick={autoSelectNext}>Auto Next →</button>
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
              <button style={S.btn} onClick={checkAnswer}>CHECK</button>
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
export function DrillsView() {
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
          return { x: pts.reduce((a,b)=>a+b[0],0)/pts.length, y: pts.reduce((a,b)=>a+b[1],0)/pts.length }
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

  if (drill === 'presidents') return <PresidentsDrill onBack={handleBack} />
  if (drill === 'worldmap') return <WorldMapDrill onBack={handleBack} preloadedPaths={worldPaths} preloadedCentroids={worldCentroids} />
  if (drill?.startsWith('region-')) return <RegionalMapDrill regionKey={drill.replace('region-','')} onBack={handleBack} worldPaths={worldPaths} worldCentroids={worldCentroids} />
  if (drill === 'us-states') return <SubnationalMapDrill onBack={handleBack} config={{ geojsonUrl:'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json', data:US_STATES, regionLabel:'State', bounds:[-130,65,24,50], width:960, height:600 }} />
  if (drill === 'canada') return <SubnationalMapDrill onBack={handleBack} config={{ geojsonUrl:'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/canada.geojson', data:CANADA_PROVINCES, regionLabel:'Province', bounds:[-141,-52,41,84], width:960, height:600 }} />
  if (drill === 'mexico') return <SubnationalMapDrill onBack={handleBack} config={{ geojsonUrl:'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/mexico.geojson', data:MEXICO_STATES, regionLabel:'State', bounds:[-118,-86,14,33], width:960, height:600 }} />

  const drillDefs = [
    { id: 'presidents', emoji: '🇺🇸', label: 'US PRESIDENTS', desc: 'All 47 presidents · number, name & years', total: 47 },
    { id: 'worldmap', emoji: '🌍', label: 'WORLD MAP', desc: 'Tap unlabeled countries · name & capital', total: 195 },
    { id: null, label: '─ REGIONAL MAPS ─', desc: '', isHeader: true },
    { id: 'region-europe', emoji: '🇪🇺', label: 'EUROPE', desc: `${REGIONS.europe.ids.size} countries`, total: REGIONS.europe.ids.size },
    { id: 'region-asia', emoji: '🌏', label: 'ASIA', desc: `${REGIONS.asia.ids.size} countries`, total: REGIONS.asia.ids.size },
    { id: 'region-africa', emoji: '🌍', label: 'AFRICA', desc: `${REGIONS.africa.ids.size} countries`, total: REGIONS.africa.ids.size },
    { id: 'region-south_america', emoji: '🌎', label: 'SOUTH AMERICA', desc: `${REGIONS.south_america.ids.size} countries`, total: REGIONS.south_america.ids.size },
    { id: 'region-oceania', emoji: '🌊', label: 'OCEANIA', desc: `${REGIONS.oceania.ids.size} countries`, total: REGIONS.oceania.ids.size },
    { id: null, label: '─ SUBNATIONAL MAPS ─', desc: '', isHeader: true },
    { id: 'us-states', emoji: '🗺', label: 'US STATES', desc: '50 states & capitals', total: 50 },
    { id: 'canada', emoji: '🍁', label: 'CANADA', desc: '13 provinces & territories', total: 13 },
    { id: 'mexico', emoji: '🇲🇽', label: 'MEXICO', desc: '32 states & capitals', total: 32 },
  ]

  return (
    <div style={{ ...S.wrap, paddingTop: 8 }}>
      <div style={S.card}>
        <div style={S.title}>DRILLS</div>
        <div style={S.subtitle}>STANDALONE PRACTICE TESTS{worldLoading ? ' · Loading maps...' : ''}</div>
      </div>

      {drillDefs.map((d, i) => {
        if (d.isHeader) return (
          <div key={i} style={{ fontSize: 9, color: '#2a3460', letterSpacing: 3, textAlign: 'center', padding: '4px 0' }}>{d.label}</div>
        )
        const history = stats[d.id] || []
        const best = history.length > 0 ? Math.max(...history.map(s => s.pct)) : null
        return (
          <button key={d.id} style={{ ...S.card, textAlign: 'left', cursor: 'pointer', border: '1px solid #1a2460', width: '100%' }} onClick={() => setDrill(d.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#f5c518', letterSpacing: 2 }}>{d.emoji} {d.label}</div>
                <div style={{ fontSize: 11, color: '#4060a0', marginTop: 2 }}>{d.desc}</div>
              </div>
              {best !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: best >= 80 ? '#4caf7d' : best >= 60 ? '#f5c518' : '#e57373' }}>{best}%</div>
                  <div style={{ fontSize: 9, color: '#4060a0', letterSpacing: 1 }}>BEST</div>
                </div>
              )}
            </div>
            {history.length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                {history.slice(0, 5).map((s, j) => (
                  <span key={j} style={{ fontSize: 9, color: s.pct >= 80 ? '#4caf7d' : s.pct >= 60 ? '#f5c518' : '#e57373', background: '#060b1a', borderRadius: 4, padding: '2px 6px', border: '1px solid #1a2040' }}>
                    {s.pct}% · {s.date}
                  </span>
                ))}
              </div>
            )}
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
function SubnationalMapDrill({ config, onBack }) {
  const [paths, setPaths] = useState([])
  const [centroids, setCentroids] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [answer, setAnswer] = useState({ region: '', capital: '' })
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [attempted, setAttempted] = useState(new Set())
  const [showReference, setShowReference] = useState(false)
  const [refMode, setRefMode] = useState('map')
  const [revealed, setRevealed] = useState(new Set())
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
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
          return { x: pts.reduce((a,b) => a + b[0], 0) / pts.length, y: pts.reduce((a,b) => a + b[1], 0) / pts.length }
        }
        const newCentroids = {}
        const built = geo.features.map(f => {
          const name = f.properties?.name || f.properties?.NAME || ''
          let d = '', centroid = null
          if (f.geometry?.type === 'Polygon') {
            d = toPath(f.geometry.coordinates)
            centroid = getCentroid(f.geometry.coordinates)
          } else if (f.geometry?.type === 'MultiPolygon') {
            d = f.geometry.coordinates.map(p => toPath(p)).join(' ')
            const largest = f.geometry.coordinates.reduce((a,b) => b[0].length > a[0].length ? b : a)
            centroid = getCentroid(largest)
          }
          if (centroid) newCentroids[name] = centroid
          return { name, d }
        }).filter(p => p.d)
        setPaths(built)
        setCentroids(newCentroids)
        setLoading(false)
      })
      .catch(() => setLoading(false))
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
    setResult({ regionCorrect, capitalCorrect, data })
    setAttempted(prev => new Set([...prev, selected]))
    const both = regionCorrect && capitalCorrect
    setScore(prev => ({ correct: prev.correct + (both ? 1 : 0), total: prev.total + 1 }))
  }

  function markItemCorrect(field) {
    if (!result) return
    setResult(prev => ({ ...prev, [field + 'Correct']: true }))
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
            <button style={{ ...S.btnSecondary, width: 36, padding: '6px 0', fontSize: 18 }} onClick={() => { setZoom(z => Math.max(z/1.5,1)); setPan({x:0,y:0}) }}>−</button>
            <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:11 }} onClick={() => { setZoom(1); setPan({x:0,y:0}) }}>Reset</button>
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
                  if (!data || !c || zoom < 1.2) return null
                  const isRevealed = revealed.has(p.name)
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
                  <span style={{ fontSize:13, color:'#c0c8e8' }}>{d.name}</span>
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

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 4px' }}>
        <button style={{ fontSize:12, color:'#4060a0', background:'none', border:'none', cursor:'pointer' }} onClick={onBack}>← Back</button>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button style={{ fontSize:11, color:'#4dd0e1', background:'none', border:'none', cursor:'pointer' }} onClick={() => setShowReference(true)}>📋 Reference</button>
          <div style={{ fontSize:11, color:'#4060a0', letterSpacing:2 }}>{score.correct}/{score.total} · {remaining} left</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:6 }}>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18 }} onClick={() => setZoom(z=>Math.min(z*1.5,8))}>+</button>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18 }} onClick={() => { setZoom(z=>Math.max(z/1.5,1)); setPan({x:0,y:0}) }}>−</button>
        <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:12 }} onClick={() => { setZoom(1); setPan({x:0,y:0}) }}>Reset</button>
        <button style={{ ...S.btn, flex:1, padding:'6px 0', fontSize:12 }} onClick={autoSelectNext}>Auto Next →</button>
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
        <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width:'100%', height:'auto', display:'block' }}>
          <rect width={vw} height={vh} fill="#060b1a" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {paths.map(p => {
              const data = getRegionData(p.name)
              const isAttempted = attempted.has(p.name)
              return (
                <path key={p.name} d={p.d}
                  fill={p.name===selected?'#f5c518':isAttempted?'#4caf7d':data?'#1a3070':'#0d1a3a'}
                  stroke="#0a0f2e" strokeWidth={0.5/zoom}
                  onClick={e => { if(!dragging){e.stopPropagation();handleClick(p.name)} }}
                  style={{ cursor:data&&!isAttempted?'pointer':'default', transition:'fill 0.15s' }}
                />
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
              <button style={{ ...S.btn, marginTop:12, fontSize:14 }} onClick={() => setSelected(null)}>TAP ANOTHER</button>
            </div>
          ) : (
            <div>
              <div style={S.subtitle}>IDENTIFY THIS {config.regionLabel.toUpperCase()}</div>
              <input ref={inputRef} style={{ ...S.input, marginTop:8, marginBottom:8 }} value={answer.region} onChange={e => setAnswer(a=>({...a,region:e.target.value}))} placeholder={`${config.regionLabel} name...`} />
              <input style={{ ...S.input, marginBottom:10 }} value={answer.capital} onChange={e => setAnswer(a=>({...a,capital:e.target.value}))} onKeyDown={e => { if(e.key==='Enter') checkAnswer() }} placeholder="Capital city..." />
              <button style={S.btn} onClick={checkAnswer}>CHECK</button>
            </div>
          )}
        </div>
      )}
      {!selected && <div style={{ textAlign:'center', fontSize:12, color:'#2a3460', padding:'8px 0' }}>Tap any {config.regionLabel.toLowerCase()} on the map</div>}
    </div>
  )
}

// ─── Regional World Map ───────────────────────────────────────────────────────
function RegionalMapDrill({ regionKey, onBack, worldPaths, worldCentroids }) {
  const region = REGIONS[regionKey]
  const [revealed, setRevealed] = useState(new Set())
  const [selected, setSelected] = useState(null)
  const [answer, setAnswer] = useState({ country: '', capital: '' })
  const [result, setResult] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [attempted, setAttempted] = useState(new Set())
  const [showReference, setShowReference] = useState(false)
  const [refMode, setRefMode] = useState('map')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const [listSearch, setListSearch] = useState('')
  const inputRef = useRef(null)

  // Filter paths to this region
  const regionPaths = worldPaths.filter(p => region.ids.has(p.id))
  const regionCountries = COUNTRIES.filter(c => region.ids.has(c.id))
  const remaining = regionCountries.length - attempted.size

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
    setResult({ countryCorrect, capitalCorrect, country })
    setAttempted(prev => new Set([...prev, selected]))
    setScore(prev => ({ correct: prev.correct + (countryCorrect && capitalCorrect ? 1 : 0), total: prev.total + 1 }))
  }

  function markItemCorrect(field) {
    setResult(prev => prev ? ({ ...prev, [field + 'Correct']: true }) : prev)
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
        <div style={{ width:'100%', background:'#060b1a', borderRadius:12, overflow:'hidden', border:'1px solid #1a2460' }}>
          <svg viewBox="0 0 960 500" style={{ width:'100%', height:'auto', display:'block' }}>
            <rect width="960" height="500" fill="#060b1a" />
            {regionPaths.map(p => {
              const country = COUNTRY_MAP[p.id]
              const isRevealed = revealed.has(p.id)
              const c = worldCentroids.current[p.id]
              return (
                <g key={p.id}>
                  <path d={p.d} fill={isRevealed?'#4dd0e1':'#1a3070'} stroke="#0a0f2e" strokeWidth="0.5"
                    onClick={() => setRevealed(prev => { const n=new Set(prev); n.has(p.id)?n.delete(p.id):n.add(p.id); return n })}
                    style={{ cursor:'pointer', transition:'fill 0.2s' }}
                  />
                  {c && country && (
                    <g onClick={() => setRevealed(prev => { const n=new Set(prev); n.has(p.id)?n.delete(p.id):n.add(p.id); return n })} style={{ cursor:'pointer' }}>
                      <text x={c.x} y={c.y-(isRevealed?5:0)} textAnchor="middle" fontSize="8" fill={isRevealed?'#fff':'#8890d0'} style={{ pointerEvents:'none', fontFamily:'sans-serif' }}>{country.name}</text>
                      {isRevealed && <text x={c.x} y={c.y+10} textAnchor="middle" fontSize="7" fill="#f5c518" style={{ pointerEvents:'none', fontFamily:'sans-serif' }}>{country.capital}</text>}
                    </g>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      )}
      {refMode === 'list' && (
        <>
          <input style={S.input} value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Search..." />
          <div style={{ ...S.card, padding:0, overflow:'hidden', maxHeight:500, overflowY:'auto' }}>
            {filteredList.map((c,i) => (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom:i<filteredList.length-1?'1px solid #0d1235':'none', background:revealed.has(c.id)?'rgba(77,208,225,0.06)':i%2===0?'transparent':'#060b1a', cursor:'pointer' }}
                onClick={() => setRevealed(prev=>{const n=new Set(prev);n.has(c.id)?n.delete(c.id):n.add(c.id);return n})}>
                <div style={{ flex:1 }}>
                  <span style={{ fontSize:13, color:'#c0c8e8' }}>{c.name}</span>
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
        </div>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18 }} onClick={() => setZoom(z=>Math.min(z*1.5,8))}>+</button>
        <button style={{ ...S.btnSecondary, width:36, padding:'6px 0', fontSize:18 }} onClick={() => { setZoom(z=>Math.max(z/1.5,1)); setPan({x:0,y:0}) }}>−</button>
        <button style={{ ...S.btnSecondary, flex:1, padding:'6px 0', fontSize:12 }} onClick={() => { setZoom(1); setPan({x:0,y:0}) }}>Reset</button>
        <button style={{ ...S.btn, flex:1, padding:'6px 0', fontSize:12 }} onClick={autoSelectNext}>Auto Next →</button>
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
        <svg viewBox="0 0 960 500" style={{ width:'100%', height:'auto', display:'block' }}>
          <rect width="960" height="500" fill="#060b1a" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {regionPaths.map(p => (
              <path key={p.id} d={p.d}
                fill={p.id===selected?'#f5c518':attempted.has(p.id)?'#4caf7d':'#1a3070'}
                stroke="#0a0f2e" strokeWidth={0.5/zoom}
                onClick={e => { if(!dragging){e.stopPropagation();handleClick(p.id)} }}
                style={{ cursor:COUNTRY_MAP[p.id]&&!attempted.has(p.id)?'pointer':'default', transition:'fill 0.15s' }}
              />
            ))}
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
              <button style={{ ...S.btn, marginTop:12, fontSize:14 }} onClick={() => setSelected(null)}>TAP ANOTHER</button>
            </div>
          ) : (
            <div>
              <div style={S.subtitle}>IDENTIFY THIS COUNTRY</div>
              <input ref={inputRef} style={{ ...S.input, marginTop:8, marginBottom:8 }} value={answer.country} onChange={e => setAnswer(a=>({...a,country:e.target.value}))} placeholder="Country name..." />
              <input style={{ ...S.input, marginBottom:10 }} value={answer.capital} onChange={e => setAnswer(a=>({...a,capital:e.target.value}))} onKeyDown={e => { if(e.key==='Enter') checkAnswer() }} placeholder="Capital city..." />
              <button style={S.btn} onClick={checkAnswer}>CHECK</button>
            </div>
          )}
        </div>
      )}
      {!selected && <div style={{ textAlign:'center', fontSize:12, color:'#2a3460', padding:'8px 0' }}>Tap any country on the map</div>}
    </div>
  )
}
