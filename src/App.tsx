import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import EditorRoute from "./components/EditorRoute";
import Index from "./pages/Index";
import Stats from "./pages/Stats";
import FlowDiagram from "./pages/FlowDiagram";
import Conversations from "./pages/Conversations";
import ConversationDetail from "./pages/ConversationDetail";
import ProjectKnowledge from "./pages/ProjectKnowledge";
import ImportPage from "./pages/ImportPage";
import NotFound from "./pages/NotFound";
import OwnerDashboard from "./pages/OwnerDashboard";
import OwnerDashboardV3 from "./pages/OwnerDashboardV3";
import MyQueue from "./pages/MyQueue";
import BulkImportReview from "./pages/BulkImportReview";
import TestChannelReview from "./pages/TestChannelReview";
import Insights from "./pages/Insights";
import InboxV3 from "./pages/InboxV3";
import AnalyticsV3 from "./pages/AnalyticsV3";
import Changelog from "./pages/Changelog";
import SlaWorkbench from "./pages/SlaWorkbench";
import SlaDashboard from "./pages/SlaDashboard";
import SlaReport from "./pages/SlaReport";
import TrendReport from "./pages/TrendReport";
import MonthlyLookback from "./pages/MonthlyLookback";
import CsatReport from "./pages/CsatReport";
import ResolutionAnatomy from "./pages/ResolutionAnatomy";
import { Navigate } from "react-router-dom";
import Customers from "./pages/Customers";
import CustomerReport from "./pages/CustomerReport";
import Backlog from "./pages/Backlog";
import Prospects from "./pages/Prospects";
import SlaWhatIf from "./pages/SlaWhatIf";
import SlaPolicyAdmin from "./pages/SlaPolicyAdmin";
import SeverityAi from "./pages/SeverityAi";
import SamReview from "./pages/SamReview";

import FloatCoverage from "./pages/FloatCoverage";
import Triage from "./pages/Triage";
import Escalations from "./pages/Escalations";
import ActionCenter from "./pages/ActionCenter";
import Users from "./pages/Users";
import People from "./pages/People";
import Incidents from "./pages/Incidents";
import DeepSearch from "./pages/DeepSearch";
import SlackReturn from "./pages/oauth/SlackReturn";
import { ActionSignalsProvider } from "./hooks/useActionSignals";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ActionSignalsProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/oauth/slack/return" element={<SlackReturn />} />
          <Route path="/" element={<ProtectedRoute><AnalyticsV3 /></ProtectedRoute>} />
          <Route path="/stats" element={<ProtectedRoute><Stats /></ProtectedRoute>} />
          <Route path="/action-center" element={<ProtectedRoute><ActionCenter /></ProtectedRoute>} />
          <Route path="/conversations" element={<ProtectedRoute><Conversations /></ProtectedRoute>} />
          <Route path="/triage" element={<EditorRoute><Triage /></EditorRoute>} />
          <Route path="/escalations" element={<EditorRoute><Escalations /></EditorRoute>} />


          <Route path="/inbox-v3" element={<ProtectedRoute><InboxV3 /></ProtectedRoute>} />
          <Route path="/analytics-v3" element={<ProtectedRoute><AnalyticsV3 /></ProtectedRoute>} />

          <Route path="/customer-report" element={<ProtectedRoute><CustomerReport /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
          <Route path="/conversations/:id" element={<ProtectedRoute><ConversationDetail /></ProtectedRoute>} />
          <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
          <Route path="/my-queue" element={<ProtectedRoute><MyQueue /></ProtectedRoute>} />
          <Route path="/my-queue/:owner" element={<ProtectedRoute><MyQueue /></ProtectedRoute>} />
          <Route path="/my/:owner" element={<ProtectedRoute><OwnerDashboard /></ProtectedRoute>} />
          <Route path="/my-v3/:owner" element={<ProtectedRoute><OwnerDashboardV3 /></ProtectedRoute>} />
          <Route path="/import" element={<EditorRoute><ImportPage /></EditorRoute>} />
          <Route path="/import/bulk" element={<EditorRoute><BulkImportReview /></EditorRoute>} />
          <Route path="/test-review" element={<EditorRoute><TestChannelReview /></EditorRoute>} />
          <Route path="/settings" element={<EditorRoute><Index /></EditorRoute>} />
          {/* /users retired 21 Sep 2026 — People is the single people-management pane. */}
          <Route path="/users" element={<Navigate to="/people" replace />} />
          <Route path="/people" element={<ProtectedRoute><People /></ProtectedRoute>} />
          <Route path="/incidents" element={<ProtectedRoute><Incidents /></ProtectedRoute>} />
          <Route path="/search" element={<ProtectedRoute><DeepSearch /></ProtectedRoute>} />
          <Route path="/backlog" element={<EditorRoute><Backlog /></EditorRoute>} />
          <Route path="/prospects" element={<ProtectedRoute><Prospects /></ProtectedRoute>} />
          <Route path="/sam-review" element={<ProtectedRoute><SamReview /></ProtectedRoute>} />
          <Route path="/sla-what-if" element={<ProtectedRoute><SlaWhatIf /></ProtectedRoute>} />
          <Route path="/sla-policy" element={<ProtectedRoute><SlaPolicyAdmin /></ProtectedRoute>} />
          <Route path="/severity-ai" element={<ProtectedRoute><SeverityAi /></ProtectedRoute>} />

          <Route path="/float-coverage" element={<EditorRoute><FloatCoverage /></EditorRoute>} />
          <Route path="/flow" element={<EditorRoute><FlowDiagram /></EditorRoute>} />
          <Route path="/knowledge" element={<EditorRoute><ProjectKnowledge /></EditorRoute>} />
          <Route path="/changelog" element={<ProtectedRoute><Changelog /></ProtectedRoute>} />
          <Route path="/sla" element={<ProtectedRoute><SlaDashboard /></ProtectedRoute>} />
          <Route path="/sla-report" element={<ProtectedRoute><SlaReport /></ProtectedRoute>} />
          <Route path="/csat-report" element={<ProtectedRoute><CsatReport /></ProtectedRoute>} />
          <Route path="/trend-report" element={<ProtectedRoute><TrendReport /></ProtectedRoute>} />
          <Route path="/monthly-lookback" element={<ProtectedRoute><MonthlyLookback /></ProtectedRoute>} />
          <Route path="/resolution-anatomy" element={<ProtectedRoute><ResolutionAnatomy /></ProtectedRoute>} />

          <Route path="/sla-workbench" element={<ProtectedRoute><SlaWorkbench /></ProtectedRoute>} />

          <Route path="/sla-test" element={<Navigate to="/sla" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ActionSignalsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
