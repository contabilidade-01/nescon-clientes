import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { empresaEh12x36 } from "@/lib/suspensaoPeriodo";

/**
 * A empresa está em 12x36? Junta a flag da sessão (gravada no login) com a resposta
 * atual do servidor.
 *
 * A sessão só era atualizada na tela inicial. No celular o navegador reabre direto na
 * última página (ex.: /suspensao), sem passar pela inicial; se a escala foi marcada no
 * cadastro depois do login, o telefone seguia contando dia corrido e prometendo retorno
 * no dia seguinte, enquanto o PC (login mais recente) já mostrava o retorno certo.
 * Aqui a tela pergunta ao servidor ao abrir. Se ele responder true/false, vale o
 * cadastro atual; falha de rede ou API antiga (null) ficam com o que a sessão diz. Os
 * CNPJs fixos de 12x36 (empresaEh12x36) continuam ligados em qualquer caso.
 */
export function useEscala12x36(): boolean {
  const { company } = useAuth();
  const [doServidor, setDoServidor] = useState<boolean | null>(null);

  useEffect(() => {
    if (!company?.id) return;
    let cancelado = false;
    api.auth
      .companySession()
      .then((data) => {
        if (!cancelado && typeof data.escala_12x36 === "boolean") setDoServidor(data.escala_12x36);
      })
      .catch(() => {
        /* sem rede: fica com o que a sessão diz */
      });
    return () => {
      cancelado = true;
    };
  }, [company?.id]);

  return empresaEh12x36({ escala12x36: doServidor ?? company?.escala12x36, cnpj: company?.cnpj });
}
