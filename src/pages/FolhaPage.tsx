import { PortalPage } from "@/components/PortalPage";
import { DeliverableList } from "@/components/DeliverableList";
import { useAuth } from "@/hooks/useAuth";

const FolhaPage = () => {
  const { company } = useAuth();
  return (
    <PortalPage title="Folha de pagamento" subtitle={company?.name}>
      <DeliverableList
        category="folha"
        emptyText="Nenhum arquivo de folha disponível ainda. Holerites e relatórios enviados pela contabilidade aparecem aqui."
      />
    </PortalPage>
  );
};

export default FolhaPage;
