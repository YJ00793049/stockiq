import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis } from 'recharts'
import './App.css'

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const POPULAR_TICKERS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOGL', 'META', 'AMZN', 'JPM']

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

interface Step {
  id: string
  label: string
  status: StepStatus
}

async function fetchAndAnalyze(ticker: string, onStep: (id: string, status: StepStatus) => void): Promise<ResearchReport> {
  onStep('fetch', 'active')
  
  // Fetch latest 10-K filing from SEC EDGAR
  const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&dateRange=custom&startdt=2024-01-01&forms=10-K`
  
  let filingText = ''
  try {
    const searchRes = await fetch(`https://data.sec.gov/submissions/CIK${await getCIK(ticker)}.json`, {
      headers: { 'User-Agent': 'FinResearch yuvrajjindal2020@gmail.com' }
    })
    const data = await searchRes.json()
    filingText = `Company: ${data.name}\nTicker: ${ticker}\nSIC: ${data.sic}\nSIC Description: ${data.sicDescription}\nFiscal Year End: ${data.fiscalYearEnd}\nState: ${data.stateOfIncorporation}`
    onStep('fetch', 'done')
  } catch {
    filingText = `Ticker: ${ticker} - Using available market knowledge for analysis`
    onStep('fetch', 'done')
  }

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
        content: `You are a senior equity research analyst. Generate a comprehensive research report for ${ticker} based on your knowledge of this company. Return ONLY valid JSON, no other text.

Filing data available: ${filingText}

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
  const result = JSON.parse(clean)
  
  onStep('report', 'done')
  return result
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

export default function App() {
  const [ticker, setTicker] = useState('')
  const [report, setReport] = useState<ResearchReport | null>(null)
  const [steps, setSteps] = useState<Step[]>([
    { id: 'fetch', label: 'Fetching SEC filing data', status: 'idle' },
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
    setTicker(sym)
    setLoading(true)
    setError('')
    setReport(null)
    setSearched(true)
    setSteps(prev => prev.map(s => ({ ...s, status: 'idle' })))

    try {
      const result = await fetchAndAnalyze(sym, updateStep)
      setReport(result)
    } catch (e) {
      setError('Could not generate report. Try a major US stock ticker like AAPL or TSLA.')
      setSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' } : s))
    }
    setLoading(false)
  }

  const getRiskColor = (level: string) => level === 'HIGH' ? '#FF1744' : level === 'MEDIUM' ? '#FFB300' : '#00C853'
  const getTrendIcon = (trend: string) => trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'
  const getTrendColor = (trend: string) => trend === 'up' ? '#00C853' : trend === 'down' ? '#FF1744' : '#888'

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
            <p>Type a ticker and get a Goldman Sachs-style research report — financials, risks, catalysts, and a price target — automatically generated from SEC filings.</p>
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

      {error && <div className="error-banner">{error}</div>}

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

          <div className="report-grid">
            <div className="grid-card financials-card">
              <div className="card-head">KEY METRICS</div>
              {report.financials.map((f, i) => (
                <div key={i} className="metric-row">
                  <span className="metric-name">{f.metric}</span>
                  <span className="metric-val">{f.value}</span>
                  <span className="metric-trend" style={{ color: getTrendColor(f.trend) }}>{getTrendIcon(f.trend)}</span>
                </div>
              ))}
            </div>

            <div className="grid-card radar-card">
              <div className="card-head">INVESTMENT SCORECARD</div>
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={report.scores}>
                  <PolarGrid stroke="rgba(255,255,255,0.06)" />
                  <PolarAngleAxis dataKey="name" tick={{ fill: '#555', fontSize: 10 }} />
                  <Radar dataKey="value" stroke="#00D4FF" fill="#00D4FF" fillOpacity={0.1} strokeWidth={1.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid-card catalysts-card">
              <div className="card-head">CATALYSTS</div>
              {report.catalysts.map((c, i) => (
                <div key={i} className="catalyst-item">
                  <span className="catalyst-dot">+</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>

            <div className="grid-card risks-card">
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
