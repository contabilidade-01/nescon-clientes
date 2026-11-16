import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peças do HUB (portal e painel): cartão, ícone em caixa, atalho, linha de setor,
 * indicador e rosca. Só apresentação — dados e permissões ficam em quem usa.
 */

type Tom = "primary" | "success" | "warning" | "destructive" | "muted";

const TOM_CAIXA: Record<Tom, string> = {
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  muted: "bg-secondary text-muted-foreground",
};

export function IconBox({
  icon: Icon,
  tom = "primary",
  className,
}: {
  icon: LucideIcon;
  tom?: Tom;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
        TOM_CAIXA[tom],
        className
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

export function HubCard({
  icon,
  titulo,
  acao,
  tom,
  className,
  children,
}: {
  icon?: LucideIcon;
  titulo?: React.ReactNode;
  /** Link/botão à direita do título (ex.: "Abrir setor"). */
  acao?: React.ReactNode;
  tom?: Tom;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4 sm:p-5", className)}>
      {(icon || titulo) && (
        <div className="flex items-center gap-3">
          {icon && <IconBox icon={icon} tom={tom} />}
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{titulo}</h2>
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

export function Atalho({
  icon: Icon,
  label,
  onClick,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-col items-center gap-2 rounded-xl p-1 text-center text-[11px] font-medium leading-tight sm:text-xs"
    >
      <span className="relative flex h-12 w-12 items-center justify-center rounded-xl border bg-card text-primary transition-colors group-hover:border-primary/50">
        <Icon className="h-5 w-5" />
        {!!badge && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
            {badge}
          </span>
        )}
      </span>
      <span className="line-clamp-2">{label}</span>
    </button>
  );
}

export function LinhaSetor({
  icon: Icon,
  titulo,
  descricao,
  onClick,
  badge,
}: {
  icon: LucideIcon;
  titulo: string;
  descricao?: string;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 border-b px-1 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 truncate text-sm font-semibold">
          {titulo}
          {badge}
        </span>
        {descricao && <span className="block truncate text-xs text-muted-foreground">{descricao}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function Indicador({
  label,
  valor,
  dica,
  tom,
  onClick,
}: {
  label: string;
  valor: React.ReactNode;
  dica?: React.ReactNode;
  tom?: Tom;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "min-w-0 rounded-xl border bg-background/50 px-3 py-2.5 text-left",
        onClick && "transition-colors hover:border-primary/50"
      )}
    >
      <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "block text-xl font-bold tabular-nums",
          tom === "destructive" && "text-destructive",
          tom === "warning" && "text-warning",
          tom === "success" && "text-success"
        )}
      >
        {valor}
      </span>
      {dica && <span className="block truncate text-[11px] text-muted-foreground">{dica}</span>}
    </Comp>
  );
}

/** Barra empilhada (proporções). Partes com valor 0 somem. */
export function BarraEmpilhada({ partes }: { partes: Array<{ valor: number; cor: string }> }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  if (!total) return <div className="h-2 rounded-full bg-secondary" />;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
      {partes
        .filter((p) => p.valor > 0)
        .map((p, i) => (
          <span key={i} className={p.cor} style={{ width: `${(p.valor / total) * 100}%` }} />
        ))}
    </div>
  );
}

/** Rosca de pagamentos: pagas, a vencer e vencidas. */
export function RoscaPagamentos({
  pagas,
  aVencer,
  vencidas,
}: {
  pagas: number;
  aVencer: number;
  vencidas: number;
}) {
  const total = pagas + aVencer + vencidas;
  const C = 2 * Math.PI * 15.9; // ≈ 100
  const fatias = [
    { n: pagas, cls: "stroke-success", label: "pagas", dot: "bg-success" },
    { n: aVencer, cls: "stroke-warning", label: "a vencer", dot: "bg-warning" },
    { n: vencidas, cls: "stroke-destructive", label: "vencidas", dot: "bg-destructive" },
  ];
  let acumulado = 0;
  return (
    <div className="mt-3 flex items-center gap-5">
      <svg
        viewBox="0 0 42 42"
        className="h-24 w-24 shrink-0 -rotate-90"
        role="img"
        aria-label={`${pagas} pagas, ${aVencer} a vencer, ${vencidas} vencidas`}
      >
        <circle cx="21" cy="21" r="15.9" fill="none" className="stroke-secondary" strokeWidth="6" />
        {total > 0 &&
          fatias.map((f) => {
            if (!f.n) return null;
            const len = (f.n / total) * C;
            const el = (
              <circle
                key={f.label}
                cx="21"
                cy="21"
                r="15.9"
                fill="none"
                className={f.cls}
                strokeWidth="6"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-acumulado}
              />
            );
            acumulado += len;
            return el;
          })}
        <text
          x="21"
          y="21"
          textAnchor="middle"
          dominantBaseline="central"
          className="rotate-90 fill-foreground text-[8px] font-bold"
          style={{ transformOrigin: "21px 21px" }}
        >
          {total}
        </text>
      </svg>
      <ul className="grid gap-1 text-xs text-muted-foreground">
        {fatias.map((f) => (
          <li key={f.label} className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-sm", f.dot)} />
            <span className="tabular-nums text-foreground">{f.n}</span> {f.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
