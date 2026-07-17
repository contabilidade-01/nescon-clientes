import { PortalPage } from "@/components/PortalPage";
import { DeliverableList } from "@/components/DeliverableList";
import { useAuth } from "@/hooks/useAuth";

const GuiasFiscaisPage = () => {
  const { company } = useAuth();
  return (
    <PortalPage title="Guias fiscais" subtitle={company?.name}>
      <DeliverableList
        category="guia"
        showPayment
        emptyText="Nenhuma guia disponível ainda. Assim que a contabilidade emitir, ela aparece aqui e você recebe o aviso no WhatsApp."
      />
    </PortalPage>
  );
};

export default GuiasFiscaisPage;
