import { useCallback, useEffect, useState } from "react";
import type { Proposal } from "./api";

/** Whether a key press is text entry, which shortcuts must leave alone (radios and checkboxes are not). */
export function isTyping(target: EventTarget | null): boolean {
   const el = target as HTMLElement | null;
   if (!el) return false;
   if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
   return el.tagName === "INPUT" && !["radio", "checkbox", "button", "submit", "range"].includes((el as HTMLInputElement).type);
}

export interface LabelClass {
   id: number;   // 0 = background
   name: string;
}

/**
 * Paint-style labels for one batch, shared by the image and crop views so a
 * reviewer can switch between them without losing work. Pick a class (or press
 * its number key: 0 = background, 1-9 = classes in order), then click proposals
 * to give them that class; clicking one that already has the active class
 * clears it. The batch is complete once every proposal has a label, because the
 * triage service rejects partial batches.
 */
export function useBatchLabels(batchKey: string, proposals: Proposal[], classes: LabelClass[]) {
   const [labels, setLabels] = useState<Record<number, number>>({});
   const [active, setActive] = useState<number>(classes[1]?.id ?? 0);

   useEffect(() => setLabels({}), [batchKey]);

   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (isTyping(e.target)) return;
         if (e.metaKey || e.ctrlKey || e.altKey || !/^[0-9]$/.test(e.key)) return;
         const cls = classes[Number(e.key)];
         if (cls) setActive(cls.id);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
   }, [classes]);

   const toggle = useCallback((pid: number) =>
      setLabels((prev) => {
         const next = { ...prev };
         if (next[pid] === active) delete next[pid];
         else next[pid] = active;
         return next;
      }), [active]);

   /** Give `classId` to every unlabelled proposal, or only to those in `only`. */
   const fillRemaining = useCallback((classId: number, only?: number[]) =>
      setLabels((prev) => {
         const next = { ...prev };
         (only ?? proposals.map((p) => p.proposal_id)).forEach((pid) => {
            if (next[pid] === undefined) next[pid] = classId;
         });
         return next;
      }), [proposals]);

   const clear = useCallback(() => setLabels({}), []);

   const labelled = proposals.filter((p) => labels[p.proposal_id] !== undefined).length;
   return {
      labels,
      active,
      setActive,
      toggle,
      fillRemaining,
      clear,
      labelled,
      total: proposals.length,
      complete: labelled === proposals.length && proposals.length > 0,
   };
}

export type BatchLabels = ReturnType<typeof useBatchLabels>;
