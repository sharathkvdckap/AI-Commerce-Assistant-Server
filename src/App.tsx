import { Navigate, Route, Routes } from 'react-router-dom'
import { AiAssistantPage } from '@/pages/AiAssistantPage'
import { AnalyticsPage } from '@/pages/AnalyticsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/ai-assistant" replace />} />
      <Route path="/ai-assistant" element={<AiAssistantPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
    </Routes>
  )
}
