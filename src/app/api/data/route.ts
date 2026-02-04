import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/adapters";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  const symbol = searchParams.get("symbol");

  if (!sourceId || !symbol) {
    return NextResponse.json(
      { error: "Missing sourceId or symbol parameter" },
      { status: 400 }
    );
  }

  try {
    const source = await prisma.dataSource.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      return NextResponse.json(
        { error: "Data source not found" },
        { status: 404 }
      );
    }

    if (!source.isActive) {
      return NextResponse.json(
        { error: "Data source is inactive" },
        { status: 400 }
      );
    }

    const adapter = getAdapter(source.type);
    const config = JSON.parse(source.config);
    const data = await adapter.fetchData(config, symbol);

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch data" },
      { status: 500 }
    );
  }
}
