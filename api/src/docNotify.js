/**
 * Aviso de "documento novo" pelo WhatsApp — mandado pelo PRÓPRIO PORTAL.
 *
 * Antes, esse aviso dependia do sistema de guias (GCLICK) chamar POST /api/fiscal/release
 * e, do lado de lá, decidir mandar a mensagem (o portal só devolvia um campo
 * `avisar_cliente` de sinalização). Com o GCLICK pausado, ninguém nunca chamava essa
 * ponta — o cliente parava de ser avisado de documento novo e nada no sistema acusava
 * isso como erro, porque tecnicamente não era: o contrato dependia inteiro do outro lado.
 *
 * Agora que o portal já busca e libera o documento sozinho (`gclick/sync.js`), o aviso
 * sai daqui também — sem depender de mais nenhum sistema externo estar de pé.
 *
 * Reusa o MESMO limitador de envio de `alertasEnvio.js` (teto/hora, retry, trava contra
 * mandar pro próprio número da instância): é a mesma instância de WhatsApp, então o teto
 * tem que ser um só — dois limitadores independentes somados poderiam estourar o real.
 */
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { whatsappSql, JOIN_ESPELHO } = require("./alertas");
const { enviarComRetry, sobOTeto, marcarEnviado } = require("./alertasEnvio");
const { hojeSP, somarDias, minutosSP } = require("./diasBancarios");

// Janela em que o aviso de documento pode sair NA HORA (horário comercial de Brasília).
// Fora dela, o aviso é agendado para as 07:50 do DIA SEGUINTE — de propósito antes das
// 08h, para não competir com os alertas de vencimento que saem às 08h.
const JANELA_INICIO_MIN = 8 * 60; // 08:00
const JANELA_FIM_MIN = 19 * 60; // 19:00
const ENVIO_DIFERIDO_MIN = 7 * 60 + 50; // 07:50

/** Pode enviar AGORA? Só dentro do horário comercial (08:00–18:59). Função pura. */
function podeEnviarAgora(minutos) {
  return minutos >= JANELA_INICIO_MIN && minutos < JANELA_FIM_MIN;
}

/**
 * O drenador pode entregar os agendados? A partir das 07:50 e até as 19:00. Começa às
 * 07:50 para o aviso sair antes da leva de vencimentos das 08h. Função pura.
 */
function podeDrenar(minutos) {
  return minutos >= ENVIO_DIFERIDO_MIN && minutos < JANELA_FIM_MIN;
}

function portalUrl(caminho = "/") {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${caminho}` : null;
}

/** Dedup de documentos por título+competência, preservando a ordem de chegada. */
function mesclarDocumentos(...listas) {
  const mapa = new Map();
  for (const d of listas.flat()) {
    if (!d || !d.title) continue;
    mapa.set(`${d.title}|${d.competencia ?? ""}`, { title: d.title, competencia: d.competencia ?? null });
  }
  return [...mapa.values()];
}

/**
 * Guarda o aviso na fila para as 07:50 do dia seguinte. Se já houver um pendente para a
 * empresa, junta os documentos (sem duplicar) num aviso só — evita duas mensagens de
 * manhã por causa de dois syncs na madrugada.
 */
async function enfileirarDocNotify(db, companyId, documentos, enviarDia) {
  const { rows } = await db.query(
    `SELECT id, documentos FROM doc_notify_queue
      WHERE company_id = $1 AND status = 'pendente' LIMIT 1`,
    [companyId]
  );
  if (rows.length) {
    const juntos = mesclarDocumentos(rows[0].documentos || [], documentos);
    await db.query(
      `UPDATE doc_notify_queue
          SET documentos = $2::jsonb, enviar_dia = LEAST(enviar_dia, $3::date), atualizado_em = now()
        WHERE id = $1`,
      [rows[0].id, JSON.stringify(juntos), enviarDia]
    );
  } else {
    await db.query(
      `INSERT INTO doc_notify_queue (company_id, documentos, enviar_dia)
       VALUES ($1, $2::jsonb, $3::date)`,
      [companyId, JSON.stringify(mesclarDocumentos(documentos)), enviarDia]
    );
  }
}

function montarTexto(nomeEmpresa, documentos) {
  const plural = documentos.length > 1;
  const linhas = documentos
    .slice(0, 8)
    .map((d) => `• ${d.title}${d.competencia ? ` (${d.competencia})` : ""}`);
  const resto = documentos.length > 8 ? [`… e mais ${documentos.length - 8} documento(s).`] : [];
  const link = portalUrl("/documentos");

  return [
    `Olá! Chegou${plural ? "ram" : ""} novo${plural ? "s" : ""} documento${plural ? "s" : ""} no portal, ${nomeEmpresa}:`,
    "",
    ...linhas,
    ...resto,
    "",
    link ? `Acesse: ${link}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n")
    .trim();
}

/**
 * Avisa uma empresa sobre documentos recém-liberados. `documentos`: [{ title, competencia }].
 * Nunca lança — falha de envio vira `{ enviado: false, motivo }`, quem chama decide se loga.
 */
async function notificarDocumentosNovos(db, companyId, documentos) {
  if (!documentos || !documentos.length) return { enviado: false, motivo: "sem documentos" };
  if (!uazapi.configurado()) return { enviado: false, motivo: "uazapi não configurada" };

  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.avisos_documentos_ativos, ${whatsappSql("c")} AS whatsapp
         FROM companies c ${JOIN_ESPELHO}
        WHERE c.id = $1 AND c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE`,
      [companyId]
    );
    if (!rows.length) return { enviado: false, motivo: "empresa não encontrada, arquivada ou excluída" };
    const empresa = rows[0];

    // Vontade do cliente, tomada no portal dele — ver preferencias.js.
    if (empresa.avisos_documentos_ativos === false) {
      return { enviado: false, motivo: "cliente desativou avisos de documento novo" };
    }

    // Fora do horário comercial (madrugada/noite): não acorda o cliente. Vai para a fila
    // e sai às 07:50 do DIA SEGUINTE, antes dos alertas de vencimento das 08h.
    if (!podeEnviarAgora(minutosSP())) {
      const enviarDia = somarDias(hojeSP(), 1);
      await enfileirarDocNotify(db, companyId, documentos, enviarDia);
      return { enviado: false, agendado: true, motivo: `Fora do horário — agendado para ${enviarDia} às 07:50` };
    }

    const v = numeroWpp.validar(empresa.whatsapp);
    if (!v.ok) return { enviado: false, motivo: v.motivo };

    const meuNumero = await uazapi.owner();
    if (meuNumero && v.numero === meuNumero) {
      return { enviado: false, motivo: "é o próprio número da instância — o envio falharia em silêncio" };
    }

    if (!sobOTeto()) {
      return { enviado: false, motivo: "teto de envios/hora atingido — não repete sozinho, sem fila de retry" };
    }

    const texto = montarTexto(empresa.name, documentos);
    await enviarComRetry({ numero: v.numero, texto });
    marcarEnviado();
    return { enviado: true, numero: v.numero };
  } catch (err) {
    console.error("[docNotify]", companyId, err.message);
    return { enviado: false, motivo: err.message };
  }
}

/**
 * Reprocessa a fila de avisos de documento: a partir das 07:50 (Brasília) entrega os
 * agendados cujo dia chegou. Reusa as mesmas travas do envio direto (teto/hora, retry,
 * número da própria instância). Fora da janela (antes das 07:50 ou depois das 19h) não
 * faz nada — espera o próximo ciclo.
 */
async function drenarDocNotify(db) {
  if (!uazapi.configurado()) return { enviados: 0, tentadas: 0 };
  if (!podeDrenar(minutosSP())) return { enviados: 0, tentadas: 0 };

  const hoje = hojeSP();
  const { rows } = await db.query(
    `SELECT q.id, q.company_id, q.documentos, c.name,
            c.avisos_documentos_ativos, ${whatsappSql("c")} AS whatsapp
       FROM doc_notify_queue q
       JOIN companies c ON c.id = q.company_id
       ${JOIN_ESPELHO}
      WHERE q.status = 'pendente' AND q.enviar_dia <= $1::date
        AND c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
      ORDER BY q.criado_em
      LIMIT 200`,
    [hoje]
  );

  const meuNumero = await uazapi.owner();
  let enviados = 0;
  const fechar = (id, status, erro) =>
    db.query(`UPDATE doc_notify_queue SET status=$2, ultimo_erro=$3, atualizado_em=now() WHERE id=$1`, [id, status, erro ?? null]);

  for (const q of rows) {
    if (q.avisos_documentos_ativos === false) {
      await fechar(q.id, "ignorado", "cliente desativou avisos de documento");
      continue;
    }
    const v = numeroWpp.validar(q.whatsapp);
    if (!v.ok || (meuNumero && v.numero === meuNumero)) {
      await fechar(q.id, "ignorado", v.ok ? "é o próprio número da instância" : v.motivo);
      continue;
    }
    if (!sobOTeto()) break; // teto de hora: o resto fica para o próximo ciclo

    try {
      await enviarComRetry({ numero: v.numero, texto: montarTexto(q.name, q.documentos) });
      marcarEnviado();
      enviados += 1;
      await fechar(q.id, "enviado", null);
    } catch (err) {
      await db.query(
        `UPDATE doc_notify_queue SET tentativas = tentativas + 1, ultimo_erro=$2, atualizado_em=now() WHERE id=$1`,
        [q.id, err.message]
      );
      // Instância caída não melhora na próxima empresa: para o laço e tenta no próximo ciclo.
      if (err instanceof uazapi.UazapiTokenInvalido) break;
    }
  }

  return { enviados, tentadas: rows.length };
}

module.exports = {
  notificarDocumentosNovos,
  montarTexto,
  drenarDocNotify,
  podeEnviarAgora,
  podeDrenar,
  mesclarDocumentos,
};
