/**
 * Quem recebe alerta de vencimento, e o registro do que já foi mandado.
 *
 * Duas tabelas só, porque quase tudo aqui é **calculado**: a data de vencimento sai do
 * catálogo (obrigacoes.js) e a sugestão de qual obrigação a empresa tem sai das guias
 * que já estão no portal. O banco guarda apenas o que não dá para deduzir — a decisão
 * do escritório e o histórico de envio.
 *
 * `company_obligations` guarda **decisão, não estado**: uma linha com `ativo = false`
 * é o admin dizendo "não, esta empresa não recolhe isso". Sem essa linha negativa a
 * sugestão voltaria a aparecer toda vez que o cliente recebesse mais uma guia daquele
 * tipo, e o escritório passaria a vida dispensando a mesma sugestão.
 *
 * `alert_sends` existe para o envio ser idempotente: o índice único
 * (empresa, obrigação, vencimento) faz a rotina diária poder rodar duas vezes — por
 * redeploy, por retentativa — sem mandar dois WhatsApps para o mesmo cliente.
 */
async function ensureAlertasSchema(db) {
  try {
    // Cliente que não gosta de mensagem: uma chave só desliga tudo, sem ter de
    // desmarcar obrigação por obrigação (e sem perder a marcação quando religar).
    await db.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS alertas_ativos BOOLEAN NOT NULL DEFAULT true;`
    );
    // Desliga só a carona da mensagem de incentivo, mantendo o alerta de vencimento.
    await db.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS incentivo_ativo BOOLEAN NOT NULL DEFAULT true;`
    );
    // Para onde vai o alerta. Este campo é a EXCEÇÃO manual: o número normal vem do
    // espelho do G-Click (`gclick_clients.phone`), que é onde o cadastro é mantido.
    // Preenchido aqui, manda neste; vazio, vale o do espelho. Ver alertas.whatsappSql().
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp TEXT;`);

    // Escolha DO CLIENTE, não do escritório: ele marca no portal que não quer ser
    // avisado de documento novo. Separada de `alertas_ativos` (que é a chave do
    // escritório) porque são decisões de donos diferentes — misturar as duas faria o
    // escritório desfazer sem querer a vontade do cliente.
    await db.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS avisos_documentos_ativos BOOLEAN NOT NULL DEFAULT true;`
    );
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS avisos_alterados_em TIMESTAMPTZ;`);

    // Subchaves do envio, POR EMPRESA, abaixo da chave geral (`alertas_ativos`).
    //
    // A chave geral corta TUDO. Abaixo dela, três canais independentes, porque o
    // escritório precisa poder tratá-los em separado — em especial vencimento e vencido
    // do boleto: um cliente pode não querer o lembrete e ainda assim ser cobrado do que
    // já venceu (e vice-versa).
    //
    //   alertas_ativos (geral) ─ off = nada
    //   ├── avisos_gerais_ativos   → tributos, guias e férias
    //   ├── boleto_lembrete_ativo  → boleto: aviso de VENCIMENTO (véspera)
    //   └── boleto_cobranca_ativo  → boleto: aviso de VENCIDO (marcos de cobrança)
    //
    // Default true em todas: a migração não pode fazer ninguém deixar de receber o que
    // já recebia.
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS avisos_gerais_ativos  BOOLEAN NOT NULL DEFAULT true;`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS boleto_lembrete_ativo BOOLEAN NOT NULL DEFAULT true;`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS boleto_cobranca_ativo BOOLEAN NOT NULL DEFAULT true;`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS company_obligations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        obrigacao TEXT NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT true,
        -- 'auto'   = marcada pela regra (tem funcionário, tem DAS no portal...)
        -- 'manual' = o admin marcou ou desmarcou. NUNCA é sobrescrita pela regra.
        origem TEXT NOT NULL DEFAULT 'manual',
        observacao TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_obligations_unica
        ON company_obligations(company_id, obrigacao);
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS alert_sends (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        -- Várias obrigações que vencem no mesmo dia viram UMA mensagem; esta coluna
        -- guarda os códigos separados por vírgula, na ordem em que saíram no texto.
        obrigacoes TEXT NOT NULL,
        -- O DIA EM QUE O AVISO SAIU, não o vencimento. São coisas diferentes: uma
        -- mensagem pode carregar o salário que vence hoje e a guia que vence amanhã.
        -- A regra que queremos garantir é "uma mensagem por cliente por dia", e é o
        -- dia do aviso que expressa isso.
        dia_alerta DATE NOT NULL,
        texto TEXT NOT NULL,
        incentivo_message_id UUID,
        enviado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // A trava contra mandar duas vezes o mesmo aviso: UMA mensagem por cliente por dia.
    //
    // A chave já incluiu `obrigacoes`, e isso tinha um furo: bastava alguém marcar uma
    // obrigação nova entre duas execuções do dia para a lista de códigos mudar, a chave
    // virar outra e o cliente receber a segunda mensagem. O que queremos garantir não é
    // "não repetir a mesma lista", é "não falar duas vezes no mesmo dia".
    await db.query(`DROP INDEX IF EXISTS idx_alert_sends_unico;`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_sends_dia
        ON alert_sends(company_id, dia_alerta);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_sends_empresa
        ON alert_sends(company_id, enviado_em DESC);
    `);

    /**
     * "Já recebi o aviso de férias" — a dispensa é do CLIENTE e vale por
     * funcionário × limite, não em geral.
     *
     * Um interruptor global de férias resolveria o incômodo de hoje e criaria o de
     * amanhã: o cliente que dispensou em agosto não seria avisado do funcionário que
     * vence em novembro, e o passivo trabalhista aparece sem ninguém ter avisado.
     * Com a dispensa presa ao período, ela morre junto com ele — período novo volta
     * a avisar sozinho, sem o cliente ter de lembrar de religar nada.
     */
    await db.query(`
      CREATE TABLE IF NOT EXISTS vacation_alert_acks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        funcionario TEXT NOT NULL,
        limite_gozo DATE NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Identidade da dispensa passa a ser o CÓDIGO do funcionário, não o nome: dois
    // homônimos na mesma empresa não podem compartilhar a dispensa. O código é único
    // DENTRO da empresa (empresas diferentes repetem códigos — por isso a chave é sempre
    // (company_id, codigo, limite_gozo)). `funcionario` (nome) fica só para exibição.
    await db.query(`ALTER TABLE vacation_alert_acks ADD COLUMN IF NOT EXISTS codigo TEXT;`);
    // Backfill das dispensas antigas (chaveadas por nome): casa com o código do período.
    await db.query(`
      UPDATE vacation_alert_acks a
         SET codigo = vp.codigo
        FROM vacation_periods vp
       WHERE a.codigo IS NULL
         AND vp.company_id = a.company_id
         AND vp.nome = a.funcionario
         AND vp.limite_gozo = a.limite_gozo
         AND vp.codigo IS NOT NULL;
    `);
    // Troca a chave de unicidade: nome → código. A antiga sai para a nova valer.
    await db.query(`DROP INDEX IF EXISTS idx_vacation_acks_unico;`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vacation_acks_codigo
        ON vacation_alert_acks(company_id, codigo, limite_gozo);
    `);

    // Falha de envio precisa ficar registrada. Sem isto, um disparo que quebrou às 8h
    // some no log do contentor e ninguém no escritório descobre que a carteira não foi
    // avisada naquele dia — que é justamente o dia em que alguém devia ligar para o
    // cliente à mão.
    await db.query(`
      CREATE TABLE IF NOT EXISTS alert_failures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
        dia_alerta DATE NOT NULL,
        motivo TEXT NOT NULL,
        -- 'ignorado' (cadastro), 'falhou' (envio) ou 'interrompido' (instância caiu)
        tipo TEXT NOT NULL DEFAULT 'falhou',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_failures_dia
        ON alert_failures(dia_alerta DESC, criado_em DESC);
    `);

    // Fila de entrega (outbox) para reenvio robusto. O motor entrega na hora; o que
    // FALHA (instância caída, erro transitório, teto de hora) é gravado aqui e um
    // drenador reprocessa com backoff até entregar ou esgotar as tentativas. Sem isto,
    // um aviso que falhou no dia — em especial o de FÉRIAS, cujo marco é uma data exata —
    // se perderia: no dia seguinte o marco já passou e ele nunca seria recalculado.
    //
    // UNIQUE (company_id, dia_alerta): mesma invariante do alert_sends — uma mensagem
    // por cliente por dia, também na fila. `status`: pendente | enviado | falhou | ignorado.
    await db.query(`
      CREATE TABLE IF NOT EXISTS alert_outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        dia_alerta DATE NOT NULL,
        obrigacoes TEXT NOT NULL,
        texto TEXT NOT NULL,
        incentivo_message_id UUID,
        whatsapp TEXT,
        status TEXT NOT NULL DEFAULT 'pendente',
        tentativas INT NOT NULL DEFAULT 0,
        proxima_tentativa_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        ultimo_erro TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_outbox_dia
        ON alert_outbox(company_id, dia_alerta);
    `);
    // O drenador busca por "pendente cujo horário de re-tentativa já chegou".
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_outbox_pendentes
        ON alert_outbox(status, proxima_tentativa_em);
    `);

    // Fila do aviso de "documento novo" com JANELA DE HORÁRIO. O documento pode ser
    // sincronizado a qualquer hora (o G-Click trouxe um DAS às 00:07, por exemplo), mas
    // o cliente não deve ser acordado de madrugada nem avisado tarde da noite: fora da
    // janela (08h–19h de São Paulo), o aviso espera aqui e sai às 08h. `enviar_dia` é a
    // data (SP) em que ele pode sair; o drenador só entrega dentro da janela.
    await db.query(`
      CREATE TABLE IF NOT EXISTS doc_notify_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        documentos JSONB NOT NULL,
        enviar_dia DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'pendente',
        tentativas INT NOT NULL DEFAULT 0,
        ultimo_erro TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_notify_pendentes
        ON doc_notify_queue(status, enviar_dia);
    `);

    // Trava de 48h contra cobrança repetida de BOLETO. O boleto é da Cora: ela baixa
    // o status quando o cliente paga, e a sincronização tem latência. Sem este flag o
    // motor da manhã seguinte mandaria cobrança de um boleto que já está pago — não
    // dá para confiar só no `status` no momento da consulta. Atualizado em
    // `alertas.registrarEnvio` toda vez que um BOLETO entra numa mensagem enviada.
    //
    // Sem índice de propósito: a leitura é por `category = 'boleto' AND status IS
    // DISTINCT FROM 'paid'`, que já é restritivo; o flag é só um filtro fino em cima.
    await db.query(`
      ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ;
    `);

    console.log("[DB] alertas: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureAlertasSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureAlertasSchema };
