// src/loop/hitl.ts
import { randomUUID } from "crypto";

export interface HITLRequest {
  requestId: string;
  threadId: string;
  traceId: string;
  reason: string;
  pendingAction: string;
  options: ("approve" | "reject" | "modify")[];
}

type Stored = HITLRequest & { decision?: "approve" | "reject" | "modify" };

export interface HITLStore {
  create(req: Omit<HITLRequest, "requestId">): HITLRequest;
  get(requestId: string): HITLRequest | undefined;
  getByThread(threadId: string): HITLRequest | undefined;
  resolve(
    requestId: string,
    decision: "approve" | "reject" | "modify",
    note?: string,
  ): HITLRequest | undefined;
}

export function createHITLStore(): HITLStore {
  const map = new Map<string, Stored>();
  return {
    create(req) {
      const full: Stored = { ...req, requestId: randomUUID() };
      map.set(full.requestId, full);
      return full;
    },
    get: (id) => map.get(id),
    getByThread: (thread) => {
      for (const r of map.values()) {
        if (r.threadId === thread && !r.decision) return r;
      }
      return undefined;
    },
    resolve(id, decision) {
      const r = map.get(id);
      if (!r) return undefined;
      r.decision = decision;
      return r;
    },
  };
}
