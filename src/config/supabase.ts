import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

console.log("SUPABASE_URL:", SUPABASE_URL ? "✅ Found" : "❌ Missing");
console.log("SUPABASE_KEY:", SUPABASE_KEY ? "✅ Found" : "❌ Missing");

if (!SUPABASE_URL) {
  throw new Error("❌ Missing SUPABASE_URL in .env");
}
if (!SUPABASE_KEY) {
  throw new Error("❌ Missing SUPABASE_KEY in .env");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
