import { errorResponse, InputError, json, requestJson, withBudget } from "../../../../lib/documents/http.ts";
import { analysisStore, type AnalysisStore } from "../../../../lib/documents/store.ts";
import { createLegalApiClient, type LegalApiClient } from "../../../../lib/legal/client.ts";
import { resolveSelectedLegalContext } from "../../../../lib/legal/resolver.ts";
import type { LegalCandidate, LegalContext, LegalReferenceHints } from "../../../../lib/legal/types.ts";
import { enrichLegalContext } from "../../../../lib/legal/procedure.ts";
import type { DocumentHint } from "../../../../lib/legal/current-form.ts";

export const maxDuration = 180;

type Dependencies = {
  store: AnalysisStore;
  resolveSelected: (hints: LegalReferenceHints, candidate: LegalCandidate, signal: AbortSignal, document: DocumentHint) => Promise<LegalContext>;
};

const processClient = globalThis as typeof globalThis & { legalRouteClient?: { oc: string; client: LegalApiClient } };

function configuredClient(): LegalApiClient {
  const oc = process.env.LAW_OPEN_API_OC?.trim();
  if (!oc) throw new InputError("LEGAL_API_NOT_CONFIGURED", 503);
  if (processClient.legalRouteClient?.oc === oc) return processClient.legalRouteClient.client;
  const client = createLegalApiClient({ oc });
  processClient.legalRouteClient = { oc, client };
  return client;
}

export function createLegalRouteHandlers(dependencies: Dependencies) {
  return {
    async GET(request: Request) {
      try {
        const analysisId = new URL(request.url).searchParams.get("analysisId");
        if (!analysisId || analysisId.length > 80) throw new InputError("INVALID_JSON");
        const legal = dependencies.store.get(analysisId)?.analysis.legal;
        if (!legal) throw new InputError("LEGAL_NOT_READY", 404);
        return json(legal);
      } catch (error) { return errorResponse(error); }
    },
    async PATCH(request: Request) {
      try {
        const input = await requestJson(request);
        if (Object.keys(input).length !== 2 || typeof input.analysisId !== "string" || input.analysisId.length > 80 || typeof input.candidateId !== "string" || input.candidateId.length > 160) throw new InputError("INVALID_JSON");
        const selected = dependencies.store.selectLegalCandidate(input.analysisId, input.candidateId);
        const pending = selected.analysis.legal!;
        return await withBudget(request, async () => {
          const refreshed = await dependencies.resolveSelected({ references: pending.detectedReferences, receivingOffice: pending.printedReceivingOffice, citedArticles: pending.printedArticles }, selected.candidate, request.signal, { title: selected.analysis.document.title, fieldLabels: selected.analysis.document.fields.map(field => field.label) });
          if (request.signal.aborted) throw new InputError("CANCELLED", 499);
          const legal = { ...refreshed, detectedReferences: pending.detectedReferences, candidates: pending.candidates, printedReceivingOffice: pending.printedReceivingOffice, printedArticles: pending.printedArticles };
          return json(dependencies.store.updateLegal(input.analysisId as string, legal, selected.legalVersion).legal);
        });
      } catch (error) { return errorResponse(error); }
    },
  };
}

const handlers = createLegalRouteHandlers({
  store: analysisStore,
  resolveSelected: async (hints, candidate, signal, document) => enrichLegalContext({ ...await resolveSelectedLegalContext(hints, candidate, configuredClient(), signal), printedReceivingOffice: hints.receivingOffice, printedArticles: hints.citedArticles }, signal, { document, client: configuredClient(), keepCanonical: true }),
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
