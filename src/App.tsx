import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import Index from "./pages/Index";
import Stats from "./pages/Stats";
import FlowDiagram from "./pages/FlowDiagram";
import Conversations from "./pages/Conversations";
import ConversationDetail from "./pages/ConversationDetail";
import ProjectKnowledge from "./pages/ProjectKnowledge";
import ImportPage from "./pages/ImportPage";
import NotFound from "./pages/NotFound";
import OwnerDashboard from "./pages/OwnerDashboard";
import BulkImportReview from "./pages/BulkImportReview";
import TestChannelReview from "./pages/TestChannelReview";
import Insights from "./pages/Insights";
import InboxV2 from "./pages/InboxV2";
import AnalyticsV2 from "./pages/AnalyticsV2";
import InboxV3 from "./pages/InboxV3";
import AnalyticsV3 from "./pages/AnalyticsV3";
import Changelog from "./pages/Changelog";
import SlaWorkbench from "./pages/SlaWorkbench";
import SlaDashboard from "./pages/SlaDashboard";
import SlaReport from "./pages/SlaReport";
import { Navigate } from "react-router-dom";
import Customers from "./pages/Customers";
import CustomerReport from "./pages/CustomerReport";
import Backlog from "./pages/Backlog";
import Prospects from "./pages/Prospects";
import SlaWhatIf from "./pages/SlaWhatIf";
import SlaPolicyAdmin from "./pages/SlaPolicyAdmin";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Stats /></ProtectedRoute>} />
          <Route path="/conversations" element={<ProtectedRoute><Conversations /></ProtectedRoute>} />
          <Route path="/inbox-v2" element={<ProtectedRoute><InboxV2 /></ProtectedRoute>} />
          <Route path="/analytics-v2" element={<ProtectedRoute><AnalyticsV2 /></ProtectedRoute>} />
          <Route path="/inbox-v3" element={<ProtectedRoute><InboxV3 /></ProtectedRoute>} />
          <Route path="/analytics-v3" element={<ProtectedRoute><AnalyticsV3 /></ProtectedRoute>} />

          <Route path="/customer-report" element={<ProtectedRoute><CustomerReport /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
          <Route path="/conversations/:id" element={<ProtectedRoute><ConversationDetail /></ProtectedRoute>} />
          <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
          <Route path="/my/:owner" element={<ProtectedRoute><OwnerDashboard /></ProtectedRoute>} />
          <Route path="/import" element={<ProtectedRoute><ImportPage /></ProtectedRoute>} />
          <Route path="/import/bulk" element={<ProtectedRoute><BulkImportReview /></ProtectedRoute>} />
          <Route path="/test-review" element={<ProtectedRoute><TestChannelReview /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/backlog" element={<ProtectedRoute><Backlog /></ProtectedRoute>} />
          <Route path="/prospects" element={<ProtectedRoute><Prospects /></ProtectedRoute>} />
          <Route path="/sla-what-if" element={<ProtectedRoute><SlaWhatIf /></ProtectedRoute>} />
          <Route path="/sla-policy" element={<ProtectedRoute><SlaPolicyAdmin /></ProtectedRoute>} />
          <Route path="/flow" element={<ProtectedRoute><FlowDiagram /></ProtectedRoute>} />
          <Route path="/knowledge" element={<ProtectedRoute><ProjectKnowledge /></ProtectedRoute>} />
          <Route path="/changelog" element={<ProtectedRoute><Changelog /></ProtectedRoute>} />
          <Route path="/sla" element={<ProtectedRoute><SlaDashboard /></ProtectedRoute>} />
          <Route path="/sla-report" element={<ProtectedRoute><SlaReport /></ProtectedRoute>} />
          <Route path="/sla-workbench" element={<ProtectedRoute><SlaWorkbench /></ProtectedRoute>} />

          <Route path="/sla-test" element={<Navigate to="/sla" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
