import { useNavigate } from "react-router-dom";
import { ArrowLeft, Scale } from "lucide-react";
import { SimuladorRegime } from "@/components/regime/SimuladorRegime";
import { Button } from "@/components/ui/button";

/** Simulador de regime no portal. Só aparece depois que o escritório libera na empresa. */
const RegimePage = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-none items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Scale className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Simulador de regime (IBS/CBS)</h1>
              <p className="text-xs text-muted-foreground">O que compensa para a sua empresa depois da reforma</p>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl p-4">
        <SimuladorRegime />
      </main>
    </div>
  );
};

export default RegimePage;
