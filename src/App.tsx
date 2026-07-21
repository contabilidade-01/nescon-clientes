import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { isToolAllowed, type CompanyToolKey } from "@/lib/companyTools";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.tsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.tsx";
import SuspensionPage from "./pages/SuspensionPage.tsx";
import WarningPage from "./pages/WarningPage.tsx";
import HistoryPage from "./pages/HistoryPage.tsx";
import EmployeesPage from "./pages/EmployeesPage.tsx";
import ChatbotPage from "./pages/ChatbotPage.tsx";
import SalaryAdhocPage from "./pages/SalaryAdhocPage.tsx";
import CertificatesPage from "./pages/CertificatesPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import EnvioGuiasAdminPage from "./pages/EnvioGuiasAdminPage.tsx";
import GuiasFiscaisPage from "./pages/GuiasFiscaisPage.tsx";
import BoletosPage from "./pages/BoletosPage.tsx";
import FolhaPage from "./pages/FolhaPage.tsx";
import DocumentosPage from "./pages/DocumentosPage.tsx";
import CalendarioPage from "./pages/CalendarioPage.tsx";
import ProximosPagamentosPage from "./pages/ProximosPagamentosPage.tsx";
import EntregaPublicaPage from "./pages/EntregaPublicaPage.tsx";
import AlterarSenhaPage from "./pages/AlterarSenhaPage.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Rotas do app empresarial: administrador é redirecionado ao painel /admin */
function CompanyOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin, company } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (company?.mustChangePassword) return <Navigate to="/alterar-senha" replace />;
  return <>{children}</>;
}

function CompanyToolRoute({ tool, children }: { tool: CompanyToolKey; children: React.ReactNode }) {
  const { isLoggedIn, isAdmin, company } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (!company) return <Navigate to="/login" replace />;
  // Senha ainda é a inicial (= CNPJ, público): nada é liberado antes da troca.
  if (company.mustChangePassword) return <Navigate to="/alterar-senha" replace />;
  if (!isToolAllowed(company.toolAccess, tool)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Histórico: admin vê tudo; empresa só se a ferramenta estiver ativa */
function HistoryAccessRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin, company } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (isAdmin) return <>{children}</>;
  if (!company) return <Navigate to="/login" replace />;
  if (company.mustChangePassword) return <Navigate to="/alterar-senha" replace />;
  if (!isToolAllowed(company.toolAccess, "history")) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Troca de senha: qualquer sessão válida (é a única tela liberada no 1º acesso). */
function LoggedInRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    {/* Link do WhatsApp: sem login, identificado por token opaco */}
    <Route path="/entrega/:token" element={<EntregaPublicaPage />} />
    <Route path="/admin" element={<AdminOnlyRoute><AdminPage /></AdminOnlyRoute>} />
    {/* Única tela liberada enquanto a senha for a inicial */}
    <Route path="/alterar-senha" element={<LoggedInRoute><AlterarSenhaPage /></LoggedInRoute>} />
    <Route path="/" element={<CompanyOnlyRoute><Index /></CompanyOnlyRoute>} />
    <Route path="/suspensao" element={<CompanyToolRoute tool="suspension"><SuspensionPage /></CompanyToolRoute>} />
    <Route path="/advertencia" element={<CompanyToolRoute tool="warning"><WarningPage /></CompanyToolRoute>} />
    <Route path="/historico" element={<HistoryAccessRoute><HistoryPage /></HistoryAccessRoute>} />
    <Route path="/funcionarios" element={<CompanyToolRoute tool="employees"><EmployeesPage /></CompanyToolRoute>} />
    <Route path="/chatbot" element={<CompanyToolRoute tool="chatbot"><ChatbotPage /></CompanyToolRoute>} />
    <Route path="/salario-avulso" element={<CompanyToolRoute tool="salary_adhoc"><SalaryAdhocPage /></CompanyToolRoute>} />
    <Route path="/atestados" element={<CompanyToolRoute tool="certificates"><CertificatesPage /></CompanyToolRoute>} />
    {/* Portal do Cliente: entregas da contabilidade */}
    <Route path="/guias" element={<CompanyToolRoute tool="fiscal_guides"><GuiasFiscaisPage /></CompanyToolRoute>} />
    <Route path="/boletos" element={<CompanyToolRoute tool="boletos"><BoletosPage /></CompanyToolRoute>} />
    <Route path="/folha" element={<CompanyToolRoute tool="payroll_files"><FolhaPage /></CompanyToolRoute>} />
    <Route path="/documentos" element={<CompanyToolRoute tool="documents"><DocumentosPage /></CompanyToolRoute>} />
    <Route path="/calendario" element={<CompanyToolRoute tool="calendar"><CalendarioPage /></CompanyToolRoute>} />
    <Route path="/proximos-pagamentos" element={<CompanyToolRoute tool="calendar"><ProximosPagamentosPage /></CompanyToolRoute>} />
    {/* Painel do escritório: iframe do sistema de envio de guias (não confundir com /guias) */}
    <Route path="/admin/envio-guias" element={<AdminOnlyRoute><EnvioGuiasAdminPage /></AdminOnlyRoute>} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
