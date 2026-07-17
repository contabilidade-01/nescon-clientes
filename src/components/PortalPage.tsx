import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Telas largas (calendário) pedem mais espaço que os formulários. */
  wide?: boolean;
};

/** Cabeçalho padrão das telas internas do portal (voltar + título). */
export function PortalPage({ title, subtitle, children, wide = false }: Props) {
  const navigate = useNavigate();
  const width = wide ? "max-w-4xl" : "max-w-2xl";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className={`mx-auto flex ${width} items-center gap-3 px-4 py-3`}>
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} aria-label="Voltar ao início">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-foreground">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </header>
      <main className={`mx-auto ${width} px-4 py-6`}>{children}</main>
    </div>
  );
}
