import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PassosDoCliente } from "@/components/onboarding/PassosDoCliente";
import { api } from "@/lib/api";

/** Primeiros passos dentro do portal logado: o mesmo roteiro do link do e-mail, sem precisar dele. */
export default function PrimeirosPassosPage() {
  const queryClient = useQueryClient();
  const [itemEnviando, setItemEnviando] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["onboarding-portal"], queryFn: () => api.onboarding.portal() });

  const enviar = useMutation({
    mutationFn: ({ itemId, files }: { itemId: string; files: File[] }) => api.onboarding.enviarPortal(itemId, files),
    onMutate: ({ itemId }) => setItemEnviando(itemId),
    onSuccess: (novo) => {
      queryClient.setQueryData(["onboarding-portal"], { onboarding: novo });
      toast.success("Arquivo recebido. Obrigado!");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setItemEnviando(null),
  });

  const voltar = (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/">
          <ArrowLeft className="mr-1 h-4 w-4" /> Início
        </Link>
      </Button>
    </div>
  );

  if (q.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!q.data?.onboarding) {
    return (
      <>
        {voltar}
        <div className="mx-auto max-w-md px-4 py-12">
          <Card>
            <CardContent className="p-6 text-center">
              <p className="font-medium">Nenhum passo pendente</p>
              <p className="mt-1 text-sm text-muted-foreground">Quando houver documentos a enviar, eles aparecem aqui.</p>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }
  return (
    <>
      {voltar}
      <PassosDoCliente dados={q.data.onboarding} itemEnviando={itemEnviando} onEnviar={(itemId, files) => enviar.mutate({ itemId, files })} />
    </>
  );
}
