import { PortalPage } from "@/components/PortalPage";
import { DeliverableList } from "@/components/DeliverableList";
import { useAuth } from "@/hooks/useAuth";

const DocumentosPage = () => {
  const { company } = useAuth();
  return (
    <PortalPage title="Documentos" subtitle={company?.name}>
      <DeliverableList
        category="outro"
        emptyText="Nenhum documento disponível ainda. Contratos, relatórios e demais arquivos enviados pelo escritório aparecem aqui."
      />
      <DeliverableList
        category="avulso"
        emptyText=""
      />
    </PortalPage>
  );
};

export default DocumentosPage;
