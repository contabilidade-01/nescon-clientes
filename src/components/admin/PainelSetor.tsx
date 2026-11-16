import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { BarraEmpilhada, HubCard, Indicador } from "@/components/hub/Hub";
import type { BarraSetor, IndicadorSetor } from "@/hooks/useIndicadoresSetores";
import { caminhoDoSetor, type Setor } from "@/lib/adminNav";

/** Painel de um setor na tela Geral: números, barra e atalhos para as páginas. */
export function PainelSetor({
  setor,
  indicadores,
  barra,
}: {
  setor: Setor;
  indicadores: IndicadorSetor[];
  barra?: BarraSetor;
}) {
  const navigate = useNavigate();
  const atalhos = setor.items.slice(0, 3);
  const resto = setor.items.length - atalhos.length;

  return (
    <HubCard
      icon={setor.icon}
      titulo={setor.label}
      className="flex flex-col gap-3"
      acao={
        <button
          type="button"
          onClick={() => navigate(caminhoDoSetor(setor.id))}
          className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-primary"
          data-testid={`abrir-setor-${setor.id}`}
        >
          Abrir setor <ChevronRight className="h-3.5 w-3.5" />
        </button>
      }
    >
      {indicadores.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {indicadores.slice(0, 4).map((i) => (
            <Indicador
              key={i.label}
              label={i.label}
              valor={i.valor}
              dica={i.dica}
              tom={i.tom}
              onClick={i.to ? () => navigate(i.to!) : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{setor.descricao}</p>
      )}
      {barra && (
        <div>
          <BarraEmpilhada partes={barra.partes} />
          <p className="mt-1.5 text-[11px] text-muted-foreground">{barra.legenda}</p>
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-1.5">
        {atalhos.map((i) => (
          <button
            key={i.to}
            type="button"
            onClick={() => navigate(i.to)}
            className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            {i.label}
          </button>
        ))}
        {resto > 0 && (
          <button
            type="button"
            onClick={() => navigate(caminhoDoSetor(setor.id))}
            className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            +{resto}
          </button>
        )}
      </div>
    </HubCard>
  );
}
