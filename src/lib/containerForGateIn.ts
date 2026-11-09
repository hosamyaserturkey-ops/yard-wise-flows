import { supabase } from "@/integrations/supabase/client";

export interface ContainerForGateInInput {
  yardId: string;
  containerNumber: string;
  containerType: string;
  shippingLine: string;
}

/**
 * The id of the container record a gate-in at `yardId` works with, through
 * public.container_for_gate_in. It finds the box by number even when its
 * records are all in another yard (which RLS hides from a plain select),
 * creates it when no yard has seen it, and keeps its type and line current.
 *
 * With `checkOnly` nothing is written and a box no yard has seen gives null.
 * Gate In calls it that way before collecting demurrage, so a refusal ("still
 * gated in at another yard", "needs an inspection here") comes before the
 * payment is recorded.
 *
 * Errors are thrown as Supabase returns them; the ones meant for the operator
 * are check_violation (23514) with a readable message.
 */
export async function containerForGateIn(
  input: ContainerForGateInInput,
  { checkOnly = false }: { checkOnly?: boolean } = {},
): Promise<string | null> {
  const { data, error } = await supabase.rpc("container_for_gate_in", {
    _yard_id: input.yardId,
    _container_number: input.containerNumber,
    _container_type: input.containerType,
    _shipping_line: input.shippingLine,
    _check_only: checkOnly,
  });
  if (error) throw error;
  return data ?? null;
}
