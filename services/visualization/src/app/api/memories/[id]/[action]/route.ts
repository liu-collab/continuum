import { NextRequest } from "next/server";

import { handleGovernanceActionRequest } from "../route-utils";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> }
) {
  return handleGovernanceActionRequest(request, context);
}
