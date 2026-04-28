import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  MemoryGovernanceActionRequestSchema,
  MemoryRestoreVersionRequestSchema
} from "@/lib/contracts";
import { getServerTranslator } from "@/lib/i18n/server";
import { jsonLoggedApiError, zodApiError } from "@/lib/server/api-errors";
import {
  archiveMemory,
  confirmMemory,
  deleteMemory,
  invalidateMemory,
  restoreMemoryVersion
} from "@/lib/server/storage-governance-client";

const governanceActions = {
  archive: {
    schema: MemoryGovernanceActionRequestSchema,
    method: archiveMemory,
    routeLabel: "POST /api/memories/[id]/archive",
    errorCode: "memory_archive_failed",
    errorKey: "service.apiErrors.memoryArchiveFailed"
  },
  confirm: {
    schema: MemoryGovernanceActionRequestSchema,
    method: confirmMemory,
    routeLabel: "POST /api/memories/[id]/confirm",
    errorCode: "memory_confirm_failed",
    errorKey: "service.apiErrors.memoryConfirmFailed"
  },
  delete: {
    schema: MemoryGovernanceActionRequestSchema,
    method: deleteMemory,
    routeLabel: "POST /api/memories/[id]/delete",
    errorCode: "memory_delete_failed",
    errorKey: "service.apiErrors.memoryDeleteFailed"
  },
  invalidate: {
    schema: MemoryGovernanceActionRequestSchema,
    method: invalidateMemory,
    routeLabel: "POST /api/memories/[id]/invalidate",
    errorCode: "memory_invalidate_failed",
    errorKey: "service.apiErrors.memoryInvalidateFailed"
  },
  "restore-version": {
    schema: MemoryRestoreVersionRequestSchema,
    method: restoreMemoryVersion,
    routeLabel: "POST /api/memories/[id]/restore-version",
    errorCode: "memory_restore_failed",
    errorKey: "service.apiErrors.memoryRestoreFailed"
  }
} as const;

type GovernanceActionRoute = keyof typeof governanceActions;

function isGovernanceActionRoute(action: string): action is GovernanceActionRoute {
  return action in governanceActions;
}

export async function handleGovernanceActionRequest(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> }
) {
  const { locale, t } = await getServerTranslator();
  const { id, action } = await context.params;

  if (!isGovernanceActionRoute(action)) {
    return NextResponse.json(
      {
        error: {
          code: "memory_action_not_found",
          message: t("service.apiErrors.memoryActionNotFound")
        }
      },
      { status: 404 }
    );
  }

  const config = governanceActions[action];

  try {
    const payload = config.schema.parse(await request.json()) as z.infer<typeof config.schema>;
    const data = await config.method(id, payload as never, { locale });
    return NextResponse.json(data, { status: data.ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonLoggedApiError(
      config.routeLabel,
      error,
      config.errorCode,
      t(config.errorKey),
      500
    );
  }
}
