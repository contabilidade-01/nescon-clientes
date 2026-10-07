import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PassosDoCliente } from "@/components/onboarding/PassosDoCliente";
import { api } from "@/lib/api";

/** Primeiros passos do cliente novo, por link (sem login). A tela em si é PassosDoCliente. */
export default function OnboardingPublicoPage() {
  const { token = "" } = useParams();
  const queryClient = useQueryClient();
  const [itemEnviando, setItemEnviando] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["onboarding-publico", token],
    queryFn: () => api.onboarding.get(token),
    retry: false,
  });

  const enviar = useMutation({
    mutationFn: ({ itemId, files }: { itemId: string; files: File[] }) => api.onboarding.enviar(token, itemId, files),
    onMutate: ({ itemId }) => setItemEnviando(itemId),
    onSuccess: (novo) => {
      queryClient.setQueryData(["onboarding-publico", token], novo);
      toast.success("Arquivo recebido. Obrigado!");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setItemEnviando(null),
  });

  if (q.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="font-medium">Link inválido ou expirado</p>
            <p className="mt-1 text-sm text-muted-foreground">Fale com a Nescon para receber um novo link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <PassosDoCliente dados={q.data} itemEnviando={itemEnviando} onEnviar={(itemId, files) => enviar.mutate({ itemId, files })} />;
}
