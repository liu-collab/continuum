import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    checkedAt: new Date().toISOString()
  });
}
