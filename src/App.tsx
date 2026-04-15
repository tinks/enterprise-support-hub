import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
          <Route path="/conversations/:id" element={<ProtectedRoute><ConversationDetail /></ProtectedRoute>} />
          <Route path="/my/:owner" element={<ProtectedRoute><OwnerDashboard /></ProtectedRoute>} />
          <Route path="/import" element={<ProtectedRoute><ImportPage /></ProtectedRoute>} />
          <Route path="/import/bulk" element={<ProtectedRoute><BulkImportReview /></ProtectedRoute>} />
          <Route path="/test-review" element={<ProtectedRoute><TestChannelReview /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/flow" element={<ProtectedRoute><FlowDiagram /></ProtectedRoute>} />
          <Route path="/knowledge" element={<ProtectedRoute><ProjectKnowledge /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
