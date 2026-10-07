import { Link } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { ITEM_VISAO_GERAL, setoresVisiveis } from "@/lib/adminNav";

/**
 * Tela de entrada do painel: um cartão por setor, com atalhos para as páginas dele.
 * Só mostra o que a pessoa pode ver (mesmas regras do menu). Os dados de cada página
 * continuam nas rotas de sempre.
 */
export default function HubPage() {
  const { admin } = useAuth();
  const setores = setoresVisiveis(admin);

  return (
    <AdminLayout title="Início" description="Escolha o setor para trabalhar">
      <div className="grid gap-4 md:grid-cols-2">
        {setores.map((setor) => (
          <Card key={setor.id} data-testid={`setor-${setor.id}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <setor.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">{setor.label}</CardTitle>
                  <CardDescription>{setor.descricao}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1 sm:grid-cols-2">
                {setor.items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardContent className="p-4">
            <Link to={ITEM_VISAO_GERAL.to} className="flex items-center gap-3 text-sm font-medium hover:underline">
              <LayoutDashboard className="h-5 w-5 text-primary" />
              Visão geral — números do escritório
            </Link>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
