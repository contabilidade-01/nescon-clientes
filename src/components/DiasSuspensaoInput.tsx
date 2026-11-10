import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DIAS_SUSPENSAO_MAX, DIAS_SUSPENSAO_MIN, normalizarDiasSuspensao } from "@/lib/suspensaoPeriodo";

/**
 * Campo de dias (ou plantões, na 12x36) da suspensão.
 *
 * O campo antigo trocava o valor vazio por 1 na hora. No celular, onde não dá para
 * selecionar o número e digitar por cima, o cliente apagava o "1", o campo voltava a
 * mostrar "1", e ao digitar "2" ficava "12": 12 plantões e um retorno semanas depois.
 * Aqui o campo pode ficar vazio enquanto se digita, o texto é todo selecionado ao
 * tocar, e os botões − e + ajustam sem teclado. Ao sair do campo, o texto volta a
 * mostrar o número que vale.
 */
export function DiasSuspensaoInput({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  value: number;
  onChange: (dias: number) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState(String(value));

  // Valor trocado por fora (ou pelos botões): o campo acompanha.
  useEffect(() => {
    setTexto((atual) => (atual === "" || normalizarDiasSuspensao(atual) !== value ? String(value) : atual));
  }, [value]);

  const alterar = (n: number) => {
    const dias = normalizarDiasSuspensao(String(n));
    setTexto(String(dias));
    onChange(dias);
  };

  return (
    <div className={cn("mt-1 flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-10 shrink-0"
        onClick={() => alterar(value - 1)}
        disabled={value <= DIAS_SUSPENSAO_MIN}
        aria-label="Diminuir"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={2}
        value={texto}
        className="h-10 min-w-0 text-center"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digitos = e.target.value.replace(/\D/g, "").slice(0, 2);
          setTexto(digitos);
          if (digitos !== "") onChange(normalizarDiasSuspensao(digitos));
        }}
        onBlur={() => setTexto(String(normalizarDiasSuspensao(texto)))}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-10 shrink-0"
        onClick={() => alterar(value + 1)}
        disabled={value >= DIAS_SUSPENSAO_MAX}
        aria-label="Aumentar"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
