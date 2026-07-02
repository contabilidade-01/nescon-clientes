import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuspensionForm } from "@/components/SuspensionForm";

const SuspensionPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Termo de Suspensão</h1>
            <p className="text-xs text-muted-foreground">Preencha os dados e gere o documento</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 pb-24">
        <SuspensionForm />
      </main>
    </div>
  );
};

export default SuspensionPage;
