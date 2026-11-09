import { json } from "@/lib/documents/http";
import { configurationStatus } from "@/lib/legal/config";
import { connection } from "next/server";
export async function GET() { await connection(); return json(configurationStatus(process.env)); }
