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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Stats />} />
          <Route path="/conversations" element={<Conversations />} />
          <Route path="/conversations/:id" element={<ConversationDetail />} />
          <Route path="/my/:owner" element={<OwnerDashboard />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<Index />} />
          <Route path="/flow" element={<FlowDiagram />} />
          <Route path="/knowledge" element={<ProjectKnowledge />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
