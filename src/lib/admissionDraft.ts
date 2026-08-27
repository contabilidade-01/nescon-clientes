import { mergeAdmissionDados, type AdmissionDados, type AnexoKind } from "@/lib/admissionFicha";

export type AdmissionDraft = {
  savedId: string | null;
  dados: AdmissionDados;
  empresaCnpj: string;
  empresaNome: string;
  contatoEmail: string;
  contatoTelefone: string;
  ts: number;
};

const LS_PREFIX = "nescon_admission_draft:";
const IDB_NAME = "nescon-admissao";
const IDB_STORE = "files";

export function draftScope(asCompany: boolean, companyId?: string | null) {
  if (asCompany && companyId) return `company:${companyId}`;
  return "public";
}

export function fileStoreKey(scope: string, formId: string | null | undefined) {
  return `${scope}::${formId || "novo"}`;
}

function lsKey(scope: string) {
  return `${LS_PREFIX}${scope}`;
}

export function readAdmissionDraft(scope: string): AdmissionDraft | null {
  try {
    const raw = localStorage.getItem(lsKey(scope));
    if (!raw) return null;
    const o = JSON.parse(raw) as AdmissionDraft;
    if (!o || typeof o !== "object") return null;
    return {
      savedId: o.savedId || null,
      dados: mergeAdmissionDados(o.dados),
      empresaCnpj: String(o.empresaCnpj || ""),
      empresaNome: String(o.empresaNome || ""),
      contatoEmail: String(o.contatoEmail || ""),
      contatoTelefone: String(o.contatoTelefone || ""),
      ts: Number(o.ts) || 0,
    };
  } catch {
    return null;
  }
}

export function writeAdmissionDraft(scope: string, draft: AdmissionDraft) {
  try {
    localStorage.setItem(lsKey(scope), JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

export function clearAdmissionDraft(scope: string) {
  try {
    localStorage.removeItem(lsKey(scope));
  } catch {
    /* ignore */
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fileKey(scope: string, kind: string) {
  return `${scope}:${kind}`;
}

export async function writeDraftFiles(scope: string, files: Partial<Record<AnexoKind, File>>) {
  const entries = Object.entries(files).filter(([, f]) => f) as Array<[AnexoKind, File]>;
  const prepared: Array<{ kind: AnexoKind; name: string; type: string; buffer: ArrayBuffer }> = [];
  for (const [kind, file] of entries) {
    prepared.push({
      kind,
      name: file.name,
      type: file.type,
      buffer: await file.arrayBuffer(),
    });
  }
  const db = await openDb();
  const tx = db.transaction(IDB_STORE, "readwrite");
  const store = tx.objectStore(IDB_STORE);
  const prefix = `${scope}:`;
  await new Promise<void>((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  for (const item of prepared) {
    store.put({ name: item.name, type: item.type, buffer: item.buffer }, fileKey(scope, item.kind));
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readDraftFiles(scope: string): Promise<Partial<Record<AnexoKind, File>>> {
  const out: Partial<Record<AnexoKind, File>> = {};
  try {
    const db = await openDb();
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const prefix = `${scope}:`;
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const key = String(cursor.key);
        if (key.startsWith(prefix)) {
          const kind = key.slice(prefix.length) as AnexoKind;
          const v = cursor.value as { name: string; type: string; buffer: ArrayBuffer };
          if (v?.buffer) {
            out[kind] = new File([v.buffer], v.name || `${kind}.jpg`, { type: v.type || "image/jpeg" });
          }
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    /* IndexedDB indisponível */
  }
  return out;
}

export async function clearDraftFiles(scope: string) {
  try {
    await writeDraftFiles(scope, {});
  } catch {
    /* ignore */
  }
}
