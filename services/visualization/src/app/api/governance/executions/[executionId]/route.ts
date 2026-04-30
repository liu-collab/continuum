import { NextRequest, NextResponse } from "next/server";

import { getGovernanceExecutionDetail } from "@/features/memory-catalog/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { jsonLoggedApiError } from "@/lib/server/api-errors";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  const { t } = await getServerTranslator();
  const { executionId } = await context.params;

  try {
    const data = await getGovernanceExecutionDetail(executionId);
    return NextResponse.json(data);
  } catch (error) {
    return jsonLoggedApiError(
      "GET /api/governance/executions/[executionId]",
      error,
      "governance_execution_failed",
      t("service.apiErrors.governanceExecutionFailed"),
      500
    );
  }
}
