import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import Admin from "./pages/Admin.tsx";
import Report from "./pages/Report.tsx";
import Carteira from "./pages/Carteira.tsx";
import Parcelas from "./pages/Parcelas.tsx";
import Financeiro from "./pages/Financeiro.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireHead>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/relatorio"
              element={
                <ProtectedRoute requireHead>
                  <Report />
                </ProtectedRoute>
              }
            />
            <Route
              path="/carteira"
              element={
                <ProtectedRoute>
                  <Carteira />
                </ProtectedRoute>
              }
            />
            <Route
              path="/parcelas"
              element={
                <ProtectedRoute>
                  <Parcelas />
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro"
              element={
                <ProtectedRoute>
                  <Financeiro />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
