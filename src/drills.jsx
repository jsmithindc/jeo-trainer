import { useState, useEffect, useRef } from 'react'

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

  function checkAnswer() {
    const pres = queue[idx]
    const userAns = answer.trim()
    let correct = false

    if (prompt === 'number') {
      // User types name, we show number+years
      correct = userAns.toLowerCase() === pres.name.toLowerCase()
    } else {
      // User types number, we show name+years
      correct = userAns === String(pres.num)
    }

    setResults(prev => [...prev, { president: pres, userAnswer: userAns, correct }])
    setRevealed(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function next() {
    if (idx + 1 >= queue.length) {
      setMode('results')
    } else {
      setIdx(i => i + 1)
      setAnswer('')
      setRevealed(false)
    }
  }

  const pres = queue[idx]
  const score = results.filter(r => r.correct).length

  if (mode === 'setup') return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.title}>US PRESIDENTS</div>
        <div style={S.subtitle}>ALL 47 · NAME THE PRESIDENT</div>
      </div>
      <div style={S.card}>
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
        <button style={S.btn} onClick={startQuiz}>START DRILL</button>
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
              : <span style={S.incorrect}>✗ {pres.name}</span>}
          </div>
        )}
      </div>
      {!revealed
        ? <button style={S.btn} onClick={checkAnswer}>CHECK</button>
        : <button style={S.btn} onClick={next}>{idx + 1 >= queue.length ? 'SEE RESULTS' : 'NEXT →'}</button>}
    </div>
  )
}

// ─── World Map Drill ──────────────────────────────────────────────────────────
export function WorldMapDrill({ onBack }) {
  const [geoData, setGeoData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null) // country ISO id
  const [answer, setAnswer] = useState({ country: '', capital: '' })
  const [result, setResult] = useState(null) // null | { countryCorrect, capitalCorrect }
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [attempted, setAttempted] = useState(new Set())
  const [mode, setMode] = useState('map') // map | results
  const inputRef = useRef(null)
  const svgRef = useRef(null)
  const [viewBox, setViewBox] = useState('0 0 960 500')
  const [paths, setPaths] = useState([])

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
      .then(r => r.json())
      .then(data => {
        setGeoData(data)
        setLoading(false)
        // Build simple SVG paths using d3
        buildPaths(data)
      })
      .catch(() => setLoading(false))
  }, [])

  function buildPaths(data) {
    // Simple equirectangular projection
    const w = 960, h = 500
    const project = ([lon, lat]) => [
      (lon + 180) * (w / 360),
      (90 - lat) * (h / 180)
    ]

    function coordsToPath(coords) {
      return coords.map((ring, ri) =>
        ring.map((pt, pi) => {
          const [x, y] = project(pt)
          return `${pi === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        }).join(' ') + ' Z'
      ).join(' ')
    }

    const built = data.features.map(f => {
      const id = f.id || f.properties?.iso_a3
      let d = ''
      if (f.geometry?.type === 'Polygon') {
        d = coordsToPath(f.geometry.coordinates)
      } else if (f.geometry?.type === 'MultiPolygon') {
        d = f.geometry.coordinates.map(poly => coordsToPath(poly)).join(' ')
      }
      return { id, name: f.properties?.name, d }
    }).filter(p => p.d)

    setPaths(built)
  }

  function handleCountryClick(id) {
    if (attempted.has(id)) return
    setSelected(id)
    setAnswer({ country: '', capital: '' })
    setResult(null)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function checkAnswer() {
    const country = COUNTRY_MAP[selected]
    if (!country) return
    const countryCorrect = answer.country.trim().toLowerCase() === country.name.toLowerCase()
    const capitalCorrect = answer.capital.trim().toLowerCase() === country.capital.toLowerCase()
    const bothCorrect = countryCorrect && capitalCorrect
    setResult({ countryCorrect, capitalCorrect, country })
    setAttempted(prev => new Set([...prev, selected]))
    setScore(prev => ({ correct: prev.correct + (bothCorrect ? 1 : 0), total: prev.total + 1 }))
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
        <div style={{ fontSize: 11, color: '#4060a0', letterSpacing: 2 }}>
          {score.correct}/{score.total} correct · {remaining} left
        </div>
      </div>

      {/* Map */}
      <div style={{ width: '100%', background: '#060b1a', borderRadius: 12, overflow: 'hidden', border: '1px solid #1a2460' }}>
        <svg
          ref={svgRef}
          viewBox={viewBox}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <rect width="960" height="500" fill="#060b1a" />
          {paths.map(p => (
            <path
              key={p.id}
              d={p.d}
              fill={getColor(p.id)}
              stroke="#0a0f2e"
              strokeWidth="0.5"
              onClick={() => handleCountryClick(p.id)}
              style={{ cursor: COUNTRY_MAP[p.id] ? 'pointer' : 'default', transition: 'fill 0.15s' }}
            />
          ))}
        </svg>
      </div>

      {/* Answer panel */}
      {selected && (
        <div style={S.card}>
          {result ? (
            <div>
              <div style={{ marginBottom: 6 }}>
                <span style={result.countryCorrect ? S.correct : S.incorrect}>
                  {result.countryCorrect ? '✓' : '✗'} Country: {result.country.name}
                </span>
              </div>
              <div>
                <span style={result.capitalCorrect ? S.correct : S.incorrect}>
                  {result.capitalCorrect ? '✓' : '✗'} Capital: {result.country.capital}
                </span>
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
  const [drill, setDrill] = useState(null) // null | 'presidents' | 'worldmap'

  if (drill === 'presidents') return <PresidentsDrill onBack={() => setDrill(null)} />
  if (drill === 'worldmap') return <WorldMapDrill onBack={() => setDrill(null)} />

  return (
    <div style={{ ...S.wrap, paddingTop: 8 }}>
      <div style={S.card}>
        <div style={S.title}>DRILLS</div>
        <div style={S.subtitle}>STANDALONE PRACTICE TESTS</div>
      </div>

      <button style={{ ...S.card, textAlign: 'left', cursor: 'pointer', border: '1px solid #1a2460', width: '100%' }} onClick={() => setDrill('presidents')}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#f5c518', letterSpacing: 2 }}>🇺🇸 US PRESIDENTS</div>
        <div style={{ fontSize: 11, color: '#4060a0', marginTop: 2 }}>All 47 presidents · number, name & years</div>
      </button>

      <button style={{ ...S.card, textAlign: 'left', cursor: 'pointer', border: '1px solid #1a2460', width: '100%' }} onClick={() => setDrill('worldmap')}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#f5c518', letterSpacing: 2 }}>🌍 WORLD MAP</div>
        <div style={{ fontSize: 11, color: '#4060a0', marginTop: 2 }}>Tap unlabeled countries · name & capital</div>
      </button>
    </div>
  )
}
