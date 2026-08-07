import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";

const EnviarAcessoPage = () => {
  const { data: companies, isLoading } = useAdminCompanies();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<any>(null);

  const companiesComWhatsApp = useMemo(() => {
    return (companies || []).filter((c) => c.phone);
  }, [companies]);

  const selectAll = () => {
    setSelectedIds(new Set(companiesComWhatsApp.map((c) => c.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const toggleId = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const enviarMutation = useMutation({
    mutationFn: async () => {
      const companyIds = selectedIds.size > 0 ? Array.from(selectedIds) : "all";
      return api.admin.enviarAcesso(companyIds);
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.erros.length === 0) {
        toast.success(`${data.enviados} acessos enviados por WhatsApp`);
      } else {
        toast.warning(`${data.enviados} enviados, ${data.erros.length} erros`);
      }
    },
    onError: (e: Error) => {
      toast.error(`Erro ao enviar: ${e.message}`);
    },
  });

  const handleSendAll = async () => {
    if (companiesComWhatsApp.length === 0) {
      toast.error("Nenhuma empresa com WhatsApp cadastrado");
      return;
    }
    setResult(null);
    await enviarMutation.mutateAsync();
  };

  const handleSendSelected = async () => {
    if (selectedIds.size === 0) {
      toast.error("Selecione ao menos uma empresa");
      return;
    }
    setResult(null);
    await enviarMutation.mutateAsync();
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Enviar Acesso por WhatsApp</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Gera senha provisória válida por 30 dias e envia via WhatsApp com instruções de acesso.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Senhas Provisórias
            </CardTitle>
            <CardDescription>
              {companiesComWhatsApp.length === 0
                ? "Nenhuma empresa com WhatsApp cadastrado"
                : `${companiesComWhatsApp.length} empresa${companiesComWhatsApp.length !== 1 ? "s" : ""} com WhatsApp disponível para envio`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Selecionar Todos
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                Deselecionar
              </Button>
              <div className="flex-1" />
              <Button
                onClick={handleSendAll}
                disabled={companiesComWhatsApp.length === 0 || enviarMutation.isPending}
              >
                <Send className="w-4 h-4 mr-2" />
                Enviar Todos
              </Button>
              <Button
                onClick={handleSendSelected}
                disabled={selectedIds.size === 0 || enviarMutation.isPending}
                variant="secondary"
              >
                Enviar Selecionados
              </Button>
            </div>

            <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Carregando empresas...</div>
              ) : companiesComWhatsApp.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Nenhuma empresa com WhatsApp</div>
              ) : (
                companiesComWhatsApp.map((company) => (
                  <div key={company.id} className="p-3 flex items-center gap-3 hover:bg-muted/50">
                    <Checkbox
                      checked={selectedIds.has(company.id)}
                      onCheckedChange={() => toggleId(company.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{company.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {maskCNPJ(company.cnpj)} • {company.phone}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.erros.length === 0 ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                )}
                Resultado: {result.enviados} de {result.total}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {result.enviados > 0 && (
                <div>
                  <h3 className="font-medium text-sm mb-2">✓ Enviados com sucesso:</h3>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    {result.resultados
                      .filter((r: any) => r.status === "enviado")
                      .map((r: any) => (
                        <li key={r.id}>• {r.name}</li>
                      ))}
                  </ul>
                </div>
              )}
              {result.erros.length > 0 && (
                <div>
                  <h3 className="font-medium text-sm mb-2 text-amber-700">✗ Erros:</h3>
                  <ul className="text-sm space-y-1 text-amber-600">
                    {result.erros.map((e: any) => (
                      <li key={e.id}>
                        • {e.name}: {e.erro}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-sm">ℹ Sobre as senhas provisórias</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-blue-900">
            <p>
              • Cada senha é <strong>aleatória</strong>, <strong>única</strong> e válida por <strong>30 dias</strong>
            </p>
            <p>• No <strong>primeiro acesso</strong>, o cliente obrigatoriamente troca a senha</p>
            <p>
              • O cliente também <strong>aceita os termos de LGPD</strong> antes de usar o sistema
            </p>
            <p>• A senha é enviada via WhatsApp com link de acesso e instruções</p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default EnviarAcessoPage;
