import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis } from 'recharts'
import './App.css'

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
const AV_KEY = import.meta.env.VITE_ALPHA_VANTAGE_KEY

const POPULAR_TICKERS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOGL', 'META', 'AMZN', 'JPM']
const TIME_RANGES = ['1W', '1M', '3M', '6M', '1Y']

interface PricePoint { date: string; price: number }

interface ResearchReport {
  company: string
  ticker: string
  sector: string
  recommendation: string
  confidence: number
  price_target: string
  thesis: string
  financials: { metric: string; value: string; trend: 'up' | 'down' | 'neutral' }[]
  scores: { name: string; value: number }[]
  catalysts: string[]
  risks: { text: string; level: 'HIGH' | 'MEDIUM' | 'LOW' }[]
  verdict_color: string
}

type StepStatus = 'idle' | 'active' | 'done' | 'error'
interface Step { id: string; label: string; status: StepStatus }

async function fetchDailyPrices(ticker: string): Promise<PricePoint[]> {
  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${AV_KEY}`)
    const data = await res.json()
    const series = data['Time Series (Daily)']
    if (!series) return []
    return Object.entries(series)
      .slice(0, 30)
      .reverse()
      .map(([date, vals]: [string, any]) => ({
        date: date.slice(5),
        price: parseFloat(vals['4. close'])
      }))
  } catch { return [] }
}

async function fetchWeeklyPrices(ticker: string): Promise<PricePoint[]> {
  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY&symbol=${ticker}&apikey=${AV_KEY}`)
    const data = await res.json()
    const series = data['Weekly Time Series']
    if (!series) return []
    return Object.entries(series)
      .slice(0, 52)
      .reverse()
      .map(([date, vals]: [string, any]) => ({
        date: date.slice(0, 7),
        price: parseFloat(vals['4. close'])
      }))
  } catch { return [] }
}

function filterPrices(prices: PricePoint[], dailyPrices: PricePoint[], range: string): PricePoint[] {
  if (range === '1W' || range === '1M') {
    if (!dailyPrices.length) return []
    if (range === '1W') return dailyPrices.slice(-7)
    if (range === '1M') return dailyPrices.slice(-30)
  }
  if (!prices.length) return []
  if (range === '3M') return prices.slice(-13)
  if (range === '6M') return prices.slice(-26)
  return prices
}

function getXAxisInterval(range: string, dataLen: number): number {
  if (range === '1W') return 1
  if (range === '1M') return 4
  if (range === '3M') return 2
  if (range === '6M') return 4
  return 7
}

async function getCIK(ticker: string): Promise<string> {
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': 'FinResearch yuvrajjindal2020@gmail.com' }
  })
  const data = await res.json()
  const entry = Object.values(data as Record<string, { ticker: string; cik_str: number }>)
    .find((c) => c.ticker.toUpperCase() === ticker.toUpperCase())
  if (!entry) throw new Error('Ticker not found')
  return String(entry.cik_str).padStart(10, '0')
}

async function fetchAndAnalyze(ticker: string, onStep: (id: string, status: StepStatus) => void): Promise<{ report: ResearchReport; prices: PricePoint[]; dailyPrices: PricePoint[] }> {
  onStep('fetch', 'active')

  const [weeklyPrices, dailyPrices] = await Promise.all([
    fetchWeeklyPrices(ticker),
    fetchDailyPrices(ticker)
  ])

  let filingText = ''
  try {
    const searchRes = await fetch(`https://data.sec.gov/submissions/CIK${await getCIK(ticker)}.json`, {
      headers: { 'User-Agent': 'FinResearch yuvrajjindal2020@gmail.com' }
    })
    const data = await searchRes.json()
    filingText = `Company: ${data.name}\nTicker: ${ticker}\nSIC: ${data.sic}\nSIC Description: ${data.sicDescription}\nFiscal Year End: ${data.fiscalYearEnd}`
  } catch {
    filingText = `Ticker: ${ticker}`
  }

  onStep('fetch', 'done')
  onStep('analyze', 'active')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: `You are a senior equity research analyst. Generate a comprehensive research report for ${ticker}. Return ONLY valid JSON, no other text.

Filing data: ${filingText}

Return this exact JSON:
{
  "company": "<full company name>",
  "ticker": "${ticker}",
  "sector": "<sector>",
  "recommendation": "<Strong Buy|Buy|Hold|Sell|Strong Sell>",
  "confidence": <60-95>,
  "price_target": "<e.g. $195>",
  "thesis": "<2-3 sentence investment thesis>",
  "financials": [
    {"metric": "Revenue", "value": "<value>", "trend": "<up|down|neutral>"},
    {"metric": "Net Income", "value": "<value>", "trend": "<up|down|neutral>"},
    {"metric": "EPS", "value": "<value>", "trend": "<up|down|neutral>"},
    {"metric": "Gross Margin", "value": "<value>", "trend": "<up|down|neutral>"},
    {"metric": "P/E Ratio", "value": "<value>", "trend": "<up|down|neutral>"},
    {"metric": "Debt/Equity", "value": "<value>", "trend": "<up|down|neutral>"}
  ],
  "scores": [
    {"name": "Growth", "value": <0-100>},
    {"name": "Profitability", "value": <0-100>},
    {"name": "Moat", "value": <0-100>},
    {"name": "Management", "value": <0-100>},
    {"name": "Valuation", "value": <0-100>},
    {"name": "Momentum", "value": <0-100>}
  ],
  "catalysts": ["<catalyst 1>", "<catalyst 2>", "<catalyst 3>", "<catalyst 4>"],
  "risks": [
    {"text": "<risk>", "level": "<HIGH|MEDIUM|LOW>"},
    {"text": "<risk>", "level": "<HIGH|MEDIUM|LOW>"},
    {"text": "<risk>", "level": "<HIGH|MEDIUM|LOW>"},
    {"text": "<risk>", "level": "<HIGH|MEDIUM|LOW>"}
  ],
  "verdict_color": "<#00C853 for buy|#FFB300 for hold|#FF1744 for sell>"
}`
      }]
    })
  })

  onStep('analyze', 'done')
  onStep('report', 'active')

  const data = await response.json()
  const clean = data.content[0].text.replace(/```json|```/g, '').trim()
  const report = JSON.parse(clean)

  onStep('report', 'done')
  return { report, prices: weeklyPrices, dailyPrices }
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <div className="tt-date">{label}</div>
        <div className="tt-price">${payload[0].value.toFixed(2)}</div>
      </div>
    )
  }
  return null
}

export default function App() {
  const [ticker, setTicker] = useState('')
  const [report, setReport] = useState<ResearchReport | null>(null)
  const [prices, setPrices] = useState<PricePoint[]>([])
  const [dailyPrices, setDailyPrices] = useState<PricePoint[]>([])
  const [timeRange, setTimeRange] = useState('1Y')
  const [steps, setSteps] = useState<Step[]>([
    { id: 'fetch', label: 'Fetching SEC & market data', status: 'idle' },
    { id: 'analyze', label: 'Running AI analysis', status: 'idle' },
    { id: 'report', label: 'Generating research report', status: 'idle' },
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const updateStep = (id: string, status: StepStatus) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s))
  }

  const handleSearch = async (t?: string) => {
    const sym = (t || ticker).toUpperCase().trim()
    if (!sym) return
    if (sym.length > 5) {
      setError('Please enter a valid US stock ticker (e.g. AAPL, TSLA, NVDA) — not a company name.')
      return
    }
    setTicker(sym)
    setLoading(true)
    setError('')
    setReport(null)
    setPrices([])
    setDailyPrices([])
    setSearched(true)
    setTimeRange('1Y')
    setSteps(prev => prev.map(s => ({ ...s, status: 'idle' })))

    try {
      const { report: r, prices: p, dailyPrices: dp } = await fetchAndAnalyze(sym, updateStep)
      setReport(r)
      setPrices(p)
      setDailyPrices(dp)
    } catch (e) {
      setError(`"${sym}" not found. Try a valid US stock ticker like AAPL, TSLA, NVDA, JPM, or MSFT.`)
      setSearched(false)
      setSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' } : s))
    }
    setLoading(false)
  }

  const getRiskColor = (level: string) => level === 'HIGH' ? '#FF1744' : level === 'MEDIUM' ? '#FFB300' : '#00C853'
  const getTrendIcon = (trend: string) => trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'
  const getTrendColor = (trend: string) => trend === 'up' ? '#00C853' : trend === 'down' ? '#FF1744' : '#888'

  const filteredPrices = filterPrices(prices, dailyPrices, timeRange)
  const priceChange = filteredPrices.length >= 2
    ? ((filteredPrices[filteredPrices.length - 1].price - filteredPrices[0].price) / filteredPrices[0].price * 100).toFixed(1)
    : null
  const isPositive = priceChange ? parseFloat(priceChange) >= 0 : true
  const chartColor = report?.verdict_color || '#00D4FF'
  const xInterval = getXAxisInterval(timeRange, filteredPrices.length)

  return (
    <div className="app">
      <nav className="topnav">
        <div className="nav-logo">◈ StockIQ</div>
        <div className="nav-tag">Powered by Artificio AI · Built by Yuvraj Jindal</div>
      </nav>

      <div className={`search-section ${searched ? 'search-compact' : 'search-hero'}`}>
        {!searched && (
          <div className="hero-text">
            <div className="hero-eyebrow">INSTITUTIONAL RESEARCH · POWERED BY AI</div>
            <h1>Research any stock.<br /><span className="hero-glow">In seconds.</span></h1>
            <p>Type a ticker and get a Goldman Sachs-style research report — financials, risks, catalysts, live price history, and a price target — automatically generated from SEC filings.</p>
          </div>
        )}
        <div className="search-bar-wrap">
          <div className="search-bar">
            <span className="search-prefix">$</span>
            <input
              className="search-input"
              placeholder="Enter ticker (e.g. AAPL, TSLA, NVDA)"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              autoFocus
            />
            <button className="search-btn" onClick={() => handleSearch()} disabled={loading}>
              {loading ? <span className="btn-spinner" /> : 'Analyze →'}
            </button>
          </div>
          {!searched && (
            <div className="ticker-chips">
              {POPULAR_TICKERS.map(t => (
                <button key={t} className="chip" onClick={() => handleSearch(t)}>{t}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="steps-section">
          {steps.map(step => (
            <div key={step.id} className={`step-row step-${step.status}`}>
              <div className="step-indicator">
                {step.status === 'done' ? '✓' : step.status === 'active' ? <span className="step-spin" /> : step.status === 'error' ? '✗' : '○'}
              </div>
              <span className="step-label">{step.label}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error-banner">⚠ {error}</div>}

      {report && (
        <div className="report">
          <div className="report-hero">
            <div className="report-identity">
              <div className="report-ticker">{report.ticker}</div>
              <div className="report-company">{report.company}</div>
              <div className="report-sector">{report.sector}</div>
            </div>
            <div className="report-verdict" style={{ '--vc': report.verdict_color } as React.CSSProperties}>
              <div className="verdict-rec">{report.recommendation}</div>
              <div className="verdict-target">Target: {report.price_target}</div>
              <div className="verdict-conf">{report.confidence}% confidence</div>
            </div>
          </div>

          <div className="thesis-bar">
            <span className="thesis-label">INVESTMENT THESIS</span>
            <p className="thesis-text">{report.thesis}</p>
          </div>

          {(prices.length > 0 || dailyPrices.length > 0) && (
            <div className="chart-section">
              <div className="chart-header">
                <div className="chart-left">
                  <div className="chart-title">PRICE HISTORY</div>
                  {priceChange && (
                    <div className={`chart-change ${isPositive ? 'positive' : 'negative'}`}>
                      {isPositive ? '↑' : '↓'} {Math.abs(parseFloat(priceChange))}%
                    </div>
                  )}
                </div>
                <div className="time-range-btns">
                  {TIME_RANGES.map(r => (
                    <button
                      key={r}
                      className={`range-btn ${timeRange === r ? 'range-active' : ''}`}
                      onClick={() => setTimeRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={filteredPrices} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartColor} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: '#444', fontSize: 10 }} tickLine={false} axisLine={false} interval={xInterval} />
                  <YAxis tick={{ fill: '#444', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} width={55} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="price" stroke={chartColor} strokeWidth={2} fill="url(#priceGrad)" dot={false} animationDuration={800} animationEasing="ease-out" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="report-grid">
            <div className="grid-card">
              <div className="card-head">KEY METRICS</div>
              {report.financials.map((f, i) => (
                <div key={i} className="metric-row">
                  <span className="metric-name">{f.metric}</span>
                  <span className="metric-val">{f.value}</span>
                  <span className="metric-trend" style={{ color: getTrendColor(f.trend) }}>{getTrendIcon(f.trend)}</span>
                </div>
              ))}
            </div>

            <div className="grid-card">
              <div className="card-head">INVESTMENT SCORECARD</div>
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={report.scores}>
                  <PolarGrid stroke="rgba(255,255,255,0.06)" />
                  <PolarAngleAxis dataKey="name" tick={{ fill: '#555', fontSize: 10 }} />
                  <Radar dataKey="value" stroke="#00D4FF" fill="#00D4FF" fillOpacity={0.1} strokeWidth={1.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid-card">
              <div className="card-head">CATALYSTS</div>
              {report.catalysts.map((c, i) => (
                <div key={i} className="catalyst-item">
                  <span className="catalyst-dot">+</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>

            <div className="grid-card">
              <div className="card-head">KEY RISKS</div>
              {report.risks.map((r, i) => (
                <div key={i} className="risk-item">
                  <span className="risk-text">{r.text}</span>
                  <span className="risk-pill" style={{ color: getRiskColor(r.level), borderColor: getRiskColor(r.level) }}>{r.level}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="report-footer">
            Built by Yuvraj Jindal · Artificio AI Internship · For educational purposes only · Not financial advice
          </div>
        </div>
      )}
    </div>
  )
}
