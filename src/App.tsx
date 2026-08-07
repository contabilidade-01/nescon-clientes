import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { isToolAllowed, type CompanyToolKey } from "@/lib/companyTools";
import { canSeeArea, type AdminArea } from "@/lib/adminAreas";
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
import VisaoGeralPage from "./pages/admin/VisaoGeralPage.tsx";
import EmpresasPage from "./pages/admin/EmpresasPage.tsx";
import ClientesGclickPage from "./pages/admin/ClientesGclickPage.tsx";
import FuncionariosAdminPage from "./pages/admin/FuncionariosPage.tsx";
import EntregasPage from "./pages/admin/EntregasPage.tsx";
import LicencasPage from "./pages/admin/LicencasPage.tsx";
import TaxasAnuaisPage from "./pages/admin/TaxasAnuaisPage.tsx";
import AlertasPage from "./pages/admin/AlertasPage.tsx";
import PainelFolhaPage from "./pages/admin/FolhaPage.tsx";
import LgpdPage from "./pages/admin/LgpdPage.tsx";
import SincronizacaoPage from "./pages/admin/SincronizacaoPage.tsx";
import UsuariosPage from "./pages/admin/UsuariosPage.tsx";
import DocumentUploadPage from "./pages/admin/DocumentUploadPage.tsx";
import ConfigIaPage from "./pages/admin/ConfigIaPage.tsx";
import FeriasUploadLotePage from "./pages/admin/FeriasUploadLotePage.tsx";
import EnvioGuiasAdminPage from "./pages/EnvioGuiasAdminPage.tsx";
import GuiasFiscaisPage from "./pages/GuiasFiscaisPage.tsx";
import BoletosPage from "./pages/BoletosPage.tsx";
import FolhaPage from "./pages/FolhaPage.tsx";
import CustoFolhaPage from "./pages/CustoFolhaPage.tsx";
import DocumentosPage from "./pages/DocumentosPage.tsx";
import CalendarioPage from "./pages/CalendarioPage.tsx";
import FeriasPage from "./pages/FeriasPage.tsx";
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

/**
 * Férias: além da permissão, exige funcionário celetista. Empresa só com pró-labore
 * não tem férias a programar — a regra vive em api/src/payrollRoles.js.
 */
function VacationRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin, company } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (!company) return <Navigate to="/login" replace />;
  if (company.mustChangePassword) return <Navigate to="/alterar-senha" replace />;
  if (!isToolAllowed(company.toolAccess, "vacations")) return <Navigate to="/" replace />;
  if (company.temFuncionarios === false) return <Navigate to="/" replace />;
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
  const { isLoggedIn, isAdmin, admin } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  // Senha definida pelo dono: trocar antes de usar o painel.
  if (admin?.mustChangePassword) return <Navigate to="/alterar-senha" replace />;
  return <>{children}</>;
}

/**
 * Página do painel restrita a uma área. Isto é conforto de navegação — quem impede
 * de fato o acesso aos dados é o servidor (api/src/middleware/adminArea.js).
 */
function AdminAreaRoute({ area, children }: { area: AdminArea; children: React.ReactNode }) {
  const { isLoggedIn, isAdmin, admin } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  if (admin?.mustChangePassword) return <Navigate to="/alterar-senha" replace />;
  if (!canSeeArea(area, admin?.areas, admin?.isOwner)) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/** Gestão de usuários: só o dono. */
function OwnerOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin, admin } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin || !admin?.isOwner) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    {/* Link do WhatsApp: sem login, identificado por token opaco */}
    <Route path="/entrega/:token" element={<EntregaPublicaPage />} />
    {/* Painel do escritório: uma página por área, com menu lateral retrátil (AdminLayout) */}
    <Route path="/admin" element={<AdminOnlyRoute><VisaoGeralPage /></AdminOnlyRoute>} />
    <Route path="/admin/empresas" element={<AdminAreaRoute area="empresas"><EmpresasPage /></AdminAreaRoute>} />
    <Route path="/admin/clientes-gclick" element={<OwnerOnlyRoute><ClientesGclickPage /></OwnerOnlyRoute>} />
    <Route path="/admin/funcionarios" element={<AdminAreaRoute area="funcionarios"><FuncionariosAdminPage /></AdminAreaRoute>} />
    <Route path="/admin/entregas" element={<AdminAreaRoute area="entregas"><EntregasPage /></AdminAreaRoute>} />
    <Route path="/admin/licencas" element={<AdminAreaRoute area="licencas"><LicencasPage /></AdminAreaRoute>} />
    <Route path="/admin/taxas-anuais" element={<AdminAreaRoute area="taxas_anuais"><TaxasAnuaisPage /></AdminAreaRoute>} />
    <Route path="/admin/folha" element={<AdminAreaRoute area="funcionarios"><PainelFolhaPage /></AdminAreaRoute>} />
    <Route path="/admin/alertas" element={<AdminAreaRoute area="alertas"><AlertasPage /></AdminAreaRoute>} />
    <Route path="/admin/lgpd" element={<AdminAreaRoute area="lgpd"><LgpdPage /></AdminAreaRoute>} />
    <Route path="/admin/sincronizacao" element={<AdminAreaRoute area="sincronizacao"><SincronizacaoPage /></AdminAreaRoute>} />
    <Route path="/admin/usuarios" element={<OwnerOnlyRoute><UsuariosPage /></OwnerOnlyRoute>} />
    <Route path="/admin/doc-upload" element={<AdminAreaRoute area="entregas"><DocumentUploadPage /></AdminAreaRoute>} />
    <Route path="/admin/config-ia" element={<AdminAreaRoute area="entregas"><ConfigIaPage /></AdminAreaRoute>} />
    <Route path="/admin/ferias-lote" element={<AdminAreaRoute area="funcionarios"><FeriasUploadLotePage /></AdminAreaRoute>} />
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
    <Route path="/custo-folha" element={<CompanyToolRoute tool="payroll_files"><CustoFolhaPage /></CompanyToolRoute>} />
    <Route path="/documentos" element={<CompanyToolRoute tool="documents"><DocumentosPage /></CompanyToolRoute>} />
    <Route path="/calendario" element={<CompanyToolRoute tool="calendar"><CalendarioPage /></CompanyToolRoute>} />
    <Route path="/ferias" element={<VacationRoute><FeriasPage /></VacationRoute>} />
    <Route path="/proximos-pagamentos" element={<CompanyToolRoute tool="calendar"><ProximosPagamentosPage /></CompanyToolRoute>} />
    {/* Painel do escritório: iframe do sistema de envio de guias (não confundir com /guias) */}
    <Route path="/admin/envio-guias" element={<AdminAreaRoute area="envio_guias"><EnvioGuiasAdminPage /></AdminAreaRoute>} />
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
