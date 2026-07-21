import { PortalPage } from "@/components/PortalPage";
import { DeliverableList } from "@/components/DeliverableList";
import { useAuth } from "@/hooks/useAuth";

const BoletosPage = () => {
  const { company } = useAuth();
  return (
    <PortalPage title="Boletos" subtitle={company?.name}>
      <DeliverableList
        category="boleto"
        showPayment
        emptyText="Nenhum boleto disponível ainda. Os boletos enviados pela contabilidade aparecem aqui e entram no calendário de vencimentos."
      />
    </PortalPage>
  );
};

export default BoletosPage;
